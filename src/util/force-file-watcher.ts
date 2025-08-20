import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { Mutex } from 'async-mutex';
import { ILogger } from '../types/logger';
import { ServiceContainer } from '../types/service-container';

/**
 * ForceFileWatcher wraps a VS Code FileSystemWatcher and adds optional periodic forced checks
 * to catch delayed writes or missed events. It implements the FileSystemWatcher interface,
 * making it a true drop-in replacement for VS Code's FileSystemWatcher.
 * 
 * By default, it behaves exactly like the system FileSystemWatcher (no forced flush, no debouncing).
 * Both features can be optionally enabled by setting their intervals to non-zero values.
 */
export class ForceFileWatcher implements vscode.FileSystemWatcher {
	private watcher: vscode.FileSystemWatcher;
	private forceFlushTimer?: NodeJS.Timeout;
	private isWatching = false;
	private disposables: vscode.Disposable[] = [];
	private logger: ILogger = ServiceContainer.getInstance().getLogger();
    
	// Debouncing state
	private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
	private debounceMutex = new Mutex();

	/**
     * @param globPattern Glob pattern for files to watch
     * @param forceFlushIntervalMs Interval for forced checks (ms) - 0 to disable (default: disabled)
     * @param debounceMs Debouncing interval (ms) - 0 to disable (default: disabled)
     * @param ignoreCreateEvents Ignore create events
     * @param ignoreChangeEvents Ignore change events
     * @param ignoreDeleteEvents Ignore delete events
     * @param allowedSchemes URI schemes to watch (default: ['file'] - only regular files)
     */
	constructor(
		private readonly globPattern: vscode.GlobPattern,
		public readonly forceFlushIntervalMs: number = 0,
		public readonly debounceMs: number = 0,
		public readonly ignoreCreateEvents: boolean = false,
		public readonly ignoreChangeEvents: boolean = false,
		public readonly ignoreDeleteEvents: boolean = false,
		private readonly allowedSchemes: string[] = ['file']
	) {
		this.watcher = vscode.workspace.createFileSystemWatcher(
			globPattern,
			ignoreCreateEvents,
			ignoreChangeEvents,
			ignoreDeleteEvents
		);
	}

	// Implement FileSystemWatcher interface properties with simple callback pattern
	readonly onDidChange = (listener: (uri: vscode.Uri) => any): vscode.Disposable => {
		const disposable = this.watcher.onDidChange((uri) => {
			if (this.isSchemeAllowed(uri)) {
				this.debouncedCallback(uri, [listener]);
			}
		});
		this.disposables.push(disposable);
		return disposable;
	};

	readonly onDidCreate = (listener: (uri: vscode.Uri) => any): vscode.Disposable => {
		const disposable = this.watcher.onDidCreate((uri) => {
			if (this.isSchemeAllowed(uri)) {
				this.debouncedCallback(uri, [listener]);
			}
		});
		this.disposables.push(disposable);
		return disposable;
	};

	readonly onDidDelete = (listener: (uri: vscode.Uri) => any): vscode.Disposable => {
		// Set up verified delete handler that checks if file actually exists
		const disposable = this.watcher.onDidDelete(async (uri: vscode.Uri) => {
			if (!this.isSchemeAllowed(uri)) {
				return;
			}
			
			try {
				// Verify that the file is actually gone
				await fs.stat(uri.fsPath);
				// If we get here, file still exists - this is a false delete event
				this.logger.debug(`False delete event for ${uri.fsPath} - file still exists`);
				return;
			} catch {
				// File is actually gone - this is a real delete event
				this.logger.debug(`Verified delete event for ${uri.fsPath}`);
				listener(uri);
			}
		});
        
		this.disposables.push(disposable);
		return disposable;
	};

	/**
     * Start watching and begin periodic forced checks
     */
	start(): void {
		if (this.isWatching) {
			return;
		}
		this.isWatching = true;
		// Start periodic forced checks - just poke files to trigger OS flush
		if (this.forceFlushIntervalMs > 0) {
			this.forceFlushTimer = setInterval(async () => {
				// Get all files matching the glob pattern and poke them
				const files = await vscode.workspace.findFiles(this.globPattern);
				for (const uri of files) {
					try {
						// Just poke the file to force OS flush - don't compare state
						await fs.stat(uri.fsPath);
					} catch {
						// Ignore errors for missing files, etc.
					}
				}
			}, this.forceFlushIntervalMs);
		}
	}

	/**
     * Stop watching and clear forced check timer
     */
	stop(): void {
		if (this.forceFlushTimer) {
			clearInterval(this.forceFlushTimer);
			this.forceFlushTimer = undefined;
		}
		this.isWatching = false;
	}

	/**
     * Dispose watcher and timer
     */
	dispose(): void {
		this.stop();
        
		// Clear all debounce timers
		for (const timer of this.debounceTimers.values()) {
			clearTimeout(timer);
		}
		this.debounceTimers.clear();
        
		// Dispose all event listener disposables
		for (const disposable of this.disposables) {
			try {
				disposable.dispose();
			} catch {
				// Ignore errors during disposal
			}
		}
		this.disposables = [];
		this.watcher.dispose();
	}

	/**
     * Check if the URI scheme is allowed for watching
     */
	private isSchemeAllowed(uri: vscode.Uri): boolean {
		return this.allowedSchemes.includes(uri.scheme);
	}

	/**
     * Debounced event handler - delays callback execution until events settle
     * If debouncing is disabled (debounceMs = 0), executes callbacks immediately
     */
	private debouncedCallback(uri: vscode.Uri, callbacks: Array<(uri: vscode.Uri) => void>): void {
		// If debouncing is disabled, execute immediately
		if (this.debounceMs === 0) {
			this.logger.debug(`Executing callback immediately for ${uri.toString()}`);
			callbacks.forEach(callback => callback(uri));
			return;
		}

		// Use mutex to prevent race conditions in timer management
		this.debounceMutex.runExclusive(() => {
			// Use fsPath for deduplication key to avoid scheme-based duplicates
			// This way file:///path/file.json and vscode-userdata:///path/file.json 
			// are treated as the same file
			const key = uri.fsPath || uri.toString();
			
			// If we have a timer running already, it will be fired
			// eventually and we don't need to set up a new one
			const existingTimer = this.debounceTimers.get(key);
			if (existingTimer) {
				this.logger.debug(`Debounce already scheduled for ${key}`);
				return;
			}
			this.logger.debug(`Register new timer for ${key}`);
        
			// Set new timer
			const timer = setTimeout(() => {
				// Execute all callbacks after debounce period
				callbacks.forEach(callback => callback(uri));
				this.debounceMutex.runExclusive(() => {
					this.debounceTimers.delete(key);
				});
			}, this.debounceMs);
        
			this.debounceTimers.set(key, timer);
		});
	}

	/**
     * Get watching status
     */
	getStatus(): { 
		isWatching: boolean; 
		forceFlushInterval: number; 
		debounceMs: number;
		pendingDebounces: number;
		allowedSchemes: string[];
	} {
		return {
			isWatching: this.isWatching,
			forceFlushInterval: this.forceFlushIntervalMs,
			debounceMs: this.debounceMs,
			pendingDebounces: this.debounceTimers.size,
			allowedSchemes: this.allowedSchemes
		};
	}
}
