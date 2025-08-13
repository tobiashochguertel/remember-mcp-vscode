/**
 * Window Log Watcher - Monitors ONLY the current VS Code window's logs
 * 
 * PURPOSE: "Here's what just happened in THIS current VS Code window"
 * 
 * Features:
 * - Enhanced startup: reads entire current window log + starts incremental monitoring
 * - Precise window scope using extension context
 * - Emits window-specific events for real-time UI updates
 * - Efficient incremental scanning with file position tracking
 */

import * as vscode from 'vscode';
import { ForceFileWatcher } from '../util/force-file-watcher';
import { ILogger } from '../types/logger';
import { LogParsingUtils } from './log-parsing-utils';
import { LogPathDiscovery } from './log-path-discovery';
import { WindowLogScanResult } from './log-types';

export class WindowLogWatcher {
	private windowWatcher?: ForceFileWatcher;
	private windowEventCallbacks: Array<(result: WindowLogScanResult) => void> = [];
	private isWatchingWindow = false;
	private lastFilePosition: number = 0;
	private currentLogPath: string | null = null;
	private extensionContext?: vscode.ExtensionContext;

	constructor(
		private readonly logger: ILogger,
		extensionContext?: vscode.ExtensionContext
	) {
		this.extensionContext = extensionContext;
	}

	/**
	 * Enhanced startup: Read entire current window log + start incremental monitoring
	 * This provides both historical context and real-time updates for the current window
	 */
	async startWindowWatching(): Promise<void> {
		if (this.isWatchingWindow) {
			this.logger.trace('WINDOW: Already watching current window, skipping');
			return;
		}

		// Step 1: Find current window's log path
		const logPath = await this.findCurrentWindowLogPath();
		if (!logPath) {
			this.logger.warn('WINDOW: Cannot start watching - no current window log found');
			return;
		}

		this.currentLogPath = logPath;
		this.logger.info(`WINDOW: Found current window log: ${logPath}`);

		// Step 2: Initial backfill - read entire current log
		await this.performInitialBackfill();

		// Step 3: Set up incremental watching for new content
		await this.setupCurrentWindowWatcher();
	}

	/**
	 * Perform initial backfill: read the entire current window log and emit as events
	 */
	private async performInitialBackfill(): Promise<void> {
		if (!this.currentLogPath) {
			return;
		}

		try {
			this.logger.debug('WINDOW: Starting initial backfill of current window log...');

			const content = await LogParsingUtils.readFileContent(this.currentLogPath);
			const entries = LogParsingUtils.parseMultiLineRequests(content);

			// Set file position to end after reading full content
			this.lastFilePosition = await LogParsingUtils.getFileSize(this.currentLogPath);

			if (entries.length > 0) {
				const result: WindowLogScanResult = {
					logEntries: entries,
					scope: 'window',
					metadata: {
						windowId: this.extractWindowId(this.currentLogPath),
						isBackfill: true, // This is the initial full read
						filePosition: this.lastFilePosition,
						logFilePath: this.currentLogPath
					}
				};

				this.logger.info(`WINDOW: Initial backfill complete - found ${entries.length} historical entries`);
				this.notifyWindowCallbacks(result);
			} else {
				this.logger.debug('WINDOW: No entries found in current window log during backfill');
			}
		} catch (error) {
			this.logger.error(`WINDOW: Error during initial backfill: ${error}`);
		}
	}

	/**
	 * Set up real-time watcher for the EXACT CURRENT WINDOW using *.log pattern
	 * This only monitors the same window that this extension is running in
	 */
	private async setupCurrentWindowWatcher(): Promise<void> {
		if (!this.extensionContext || !this.currentLogPath) {
			this.logger.debug('WINDOW: Cannot set up watcher - missing context or log path');
			return;
		}

		try {
			// Get the directory containing the current window's log file
			const logDirectory = LogPathDiscovery.getLogDirectory(this.currentLogPath);
			this.logger.trace(`WINDOW: Setting up *.log pattern watcher for current window: ${logDirectory}`);

			this.windowWatcher = new ForceFileWatcher(
				new vscode.RelativePattern(logDirectory, '*.log'),
				1000, // Force flush every 1s for real-time feedback
				300   // Light debouncing (300ms) for window events
			);

			this.windowWatcher.onDidCreate(async (uri) => {
				const createdFile = uri.fsPath;
				this.logger.info(`WINDOW: Log file created in current window - ${createdFile}`);
				await this.handleWindowLogChange(createdFile, false);
			});

			this.windowWatcher.onDidChange(async (uri) => {
				const changedFile = uri.fsPath;
				this.logger.trace(`WINDOW: Log file changed in current window - ${changedFile}`);
				await this.handleWindowLogChange(changedFile, false);
			});

			this.windowWatcher.onDidDelete((uri) => {
				const deletedFile = uri.fsPath;
				this.logger.info(`WINDOW: Log file deleted in current window - ${deletedFile}`);
				if (this.currentLogPath === deletedFile) {
					this.logger.trace('Current window log file was deleted, resetting position');
					this.lastFilePosition = 0;
					this.currentLogPath = null;
				}
			});

			this.windowWatcher.start();
			this.isWatchingWindow = true;
			this.logger.info('WINDOW: Successfully started watching current window');
		} catch (error) {
			this.logger.error(`WINDOW: Error setting up current window watcher: ${error}`);
		}
	}

	/**
	 * Handle changes in the current window's log file (incremental updates only)
	 */
	private async handleWindowLogChange(logPath: string, isBackfill: boolean): Promise<void> {
		// Only process changes to our current log file
		if (logPath !== this.currentLogPath) {
			this.logger.trace(`WINDOW: Ignoring change to different log file: ${logPath}`);
			return;
		}

		try {
			// Read only new content since last position
			const { content, newPosition } = await LogParsingUtils.readNewContent(logPath, this.lastFilePosition);
			
			if (!content.trim()) {
				this.logger.trace('WINDOW: No new content in current window log');
				return;
			}

			const entries = LogParsingUtils.parseMultiLineRequests(content);
			this.lastFilePosition = newPosition;

			if (entries.length > 0) {
				const result: WindowLogScanResult = {
					logEntries: entries,
					scope: 'window',
					metadata: {
						windowId: this.extractWindowId(logPath),
						isBackfill, // false for real-time updates
						filePosition: this.lastFilePosition,
						logFilePath: logPath
					}
				};

				this.logger.debug(`WINDOW: Found ${entries.length} new entries in current window`);
				this.notifyWindowCallbacks(result);
			}
		} catch (error) {
			this.logger.error(`WINDOW: Error handling window log change: ${error}`);
		}
	}

	/**
	 * Find the current window's log path using extension context
	 */
	private async findCurrentWindowLogPath(): Promise<string | null> {
		if (!this.extensionContext) {
			this.logger.debug('WINDOW: No extension context - cannot find current window log');
			return null;
		}

		const extensionLogPath = this.extensionContext.logUri.fsPath;
		return await LogPathDiscovery.findCurrentWindowLogPath(extensionLogPath);
	}

	/**
	 * Extract window ID from log file path for metadata
	 */
	private extractWindowId(logPath: string): string {
		const pathParts = logPath.split(/[/\\]/);
		const windowIndex = pathParts.findIndex(part => part.startsWith('window'));
		return windowIndex >= 0 ? pathParts[windowIndex] : 'unknown';
	}

	/**
	 * Stop window watching
	 */
	stopWindowWatching(): void {
		if (!this.isWatchingWindow) {
			return;
		}

		if (this.windowWatcher) {
			this.windowWatcher.dispose();
			this.windowWatcher = undefined;
		}

		this.isWatchingWindow = false;
		this.lastFilePosition = 0;
		this.currentLogPath = null;
		this.logger.info('WINDOW: Stopped watching current window');
	}

	/**
	 * Register callback for window log events
	 * These events represent activity in the current VS Code window only
	 */
	onWindowLogActivity(callback: (result: WindowLogScanResult) => void): void {
		this.windowEventCallbacks.push(callback);
		this.logger.trace(`WINDOW: Registered callback - now have ${this.windowEventCallbacks.length} window callbacks`);
	}

	/**
	 * Remove window log callback
	 */
	removeWindowCallback(callback: (result: WindowLogScanResult) => void): void {
		const index = this.windowEventCallbacks.indexOf(callback);
		if (index > -1) {
			this.windowEventCallbacks.splice(index, 1);
			this.logger.trace(`WINDOW: Removed callback - now have ${this.windowEventCallbacks.length} window callbacks`);
		}
	}

	/**
	 * Notify callbacks about window log activity
	 */
	private notifyWindowCallbacks(result: WindowLogScanResult): void {
		if (result.logEntries.length > 0 && this.windowEventCallbacks.length > 0) {
			this.logger.trace(`WINDOW: Notifying ${this.windowEventCallbacks.length} callbacks about ${result.logEntries.length} window entries`);
			this.windowEventCallbacks.forEach((callback, index) => {
				try {
					callback(result);
				} catch (error) {
					this.logger.trace(`WINDOW: Callback ${index + 1} error: ${error}`);
				}
			});
		}
	}

	/**
	 * Get window watcher status
	 */
	getWindowStatus(): { 
		isWatchingWindow: boolean; 
		callbackCount: number;
		filePosition: number;
		currentLogPath: string | null;
	} {
		return {
			isWatchingWindow: this.isWatchingWindow,
			callbackCount: this.windowEventCallbacks.length,
			filePosition: this.lastFilePosition,
			currentLogPath: this.currentLogPath
		};
	}

	/**
	 * Manually trigger incremental scan of current window (for testing/debugging)
	 */
	async manualWindowScan(): Promise<WindowLogScanResult | null> {
		if (!this.currentLogPath) {
			this.logger.trace('Manual window scan requested but no current log path');
			return null;
		}

		this.logger.trace('Manual window scan triggered');
		try {
			await this.handleWindowLogChange(this.currentLogPath, false);
			return null; // Result will be emitted via callbacks
		} catch (error) {
			this.logger.error(`Manual window scan error: ${error}`);
			return null;
		}
	}

	/**
	 * Cleanup resources
	 */
	dispose(): void {
		this.stopWindowWatching();
		this.windowEventCallbacks = [];
	}
}
