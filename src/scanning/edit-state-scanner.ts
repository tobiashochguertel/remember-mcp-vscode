/**
 * Edit State Scanner - Discovers and monitors VS Code chat editing state files
 * Mirrors ChatSessionScanner with minimal adaptation for editing state timelines.
 */

import * as vscode from 'vscode';
import { ForceFileWatcher } from '../util/force-file-watcher';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { EditStateFile, EditStateScanResult, EditStateScanStats, EditStateWatcherOptions, EDIT_STATE_SCAN_CONSTANTS, EditStateSessionRequests } from '../types/edit-state';
import { ILogger } from '../types/logger';

export class EditStateScanner {
	private fileWatcher?: ForceFileWatcher;
	private watcherCallbacks: Array<(result: EditStateScanResult) => void> = [];
	private isWatching = false;
	private lastUsedStoragePaths: string[] = [];

	constructor(
		private readonly storagePaths: string[],
		private readonly logger: ILogger,
		private readonly watcherOptions: EditStateWatcherOptions = {
			enableWatching: true,
			debounceMs: EDIT_STATE_SCAN_CONSTANTS.DEFAULT_DEBOUNCE_MS,
			maxRetries: EDIT_STATE_SCAN_CONSTANTS.DEFAULT_MAX_RETRIES
		}
	) {
		this.lastUsedStoragePaths = [...storagePaths];
	}

	/** Find all editing state files across VS Code storage locations */
	async findAllEditStateFiles(): Promise<string[]> {
		this.logger.info('Starting comprehensive edit state file scan...');
		const allFiles: string[] = [];
		for (const basePath of this.storagePaths) {
			try {
				const files = await this.scanStorageLocation(basePath);
				allFiles.push(...files);
				this.logger.debug(`Found ${files.length} edit state files in ${basePath}`);
			} catch (error) {
				this.logger.error(`Error scanning ${basePath}: ${error}`);
			}
		}
		this.logger.info(`Total edit state files found: ${allFiles.length}`);
		return allFiles;
	}

	/** Scan a specific VS Code storage location for editing state files */
	private async scanStorageLocation(storagePath: string): Promise<string[]> {
		const stateFiles: string[] = [];
		try {
			await fs.access(storagePath);
			const workspaceDirs = await fs.readdir(storagePath, { withFileTypes: true });
			for (const workspaceDir of workspaceDirs) {
				if (!workspaceDir.isDirectory()) {
					continue;
				}
				const editingSessionsPath = path.join(storagePath, workspaceDir.name, EDIT_STATE_SCAN_CONSTANTS.EDITING_SESSIONS_DIR);
				try {
					await fs.access(editingSessionsPath);
					const filesInDir = await this.scanEditingSessionsDirectory(editingSessionsPath);
					stateFiles.push(...filesInDir);
				} catch {
					continue; // directory missing
				}
			}
		} catch (error) {
			throw new Error(`Failed to scan storage location ${storagePath}: ${error}`);
		}
		return stateFiles;
	}

	/** Scan a chatEditingSessions directory for state.json files */
	private async scanEditingSessionsDirectory(editingSessionsPath: string): Promise<string[]> {
		const stateFiles: string[] = [];
		try {
			const subDirs = await fs.readdir(editingSessionsPath, { withFileTypes: true });
			for (const sub of subDirs) {
				if (!sub.isDirectory()) {
					continue;
				}
				const stateFilePath = path.join(editingSessionsPath, sub.name, EDIT_STATE_SCAN_CONSTANTS.STATE_FILE_NAME);
				try {
					await fs.access(stateFilePath);
					stateFiles.push(stateFilePath);
				} catch {
					continue;
				}
			}
		} catch (error) {
			throw new Error(`Failed to read editing sessions directory ${editingSessionsPath}: ${error}`);
		}
		return stateFiles;
	}

	/** Parse a single edit state file */
	async parseEditStateFile(filePath: string): Promise<EditStateScanResult | null> {
		// Simplified optimistic parser: assume structure; fail fast on JSON error only.
		try {
			const stats = await fs.stat(filePath);
			const state: EditStateFile = JSON.parse(await fs.readFile(filePath, 'utf-8'));
			// Minimal shape assumption – linearHistory array; if not, treat as empty without rejecting file.
			if (!Array.isArray((state as any).linearHistory)) {
				(state as any).linearHistory = [];
			}
			return { stateFilePath: filePath, state, lastModified: stats.mtime, fileSize: stats.size };
		} catch (err) {
			this.logger.error(`EditState parse fail ${filePath}: ${err}`);
			return null;
		}
	}

	/** Scan all editing state files and also produce raw requestId sequences per session (duplicates kept). */
	async scanAllEditStates(): Promise<{ results: EditStateScanResult[]; stats: EditStateScanStats; sessionRequests: EditStateSessionRequests[] }> {
		const started = Date.now();
		const files = await this.findAllEditStateFiles();
		const results: EditStateScanResult[] = [];
		const sessionRequests: EditStateSessionRequests[] = [];
		// Minimal metrics only
		let errorFiles = 0, totalTurns = 0;
		let oldestSession: string | undefined, newestSession: string | undefined; // preserved for compatibility (unused)
		for (const f of files) {
			const parsed = await this.parseEditStateFile(f);
			if (!parsed) { errorFiles++; continue; }
			results.push(parsed);
			const history: any[] = (parsed.state as any).linearHistory as any[];
			totalTurns += history.length;
			// Extract requestIds in order, preserving duplicates
			const reqIds: string[] = [];
			for (const turn of history) {
				if (turn && typeof turn === 'object') {
					const rid = (turn as any).requestId || (turn as any).telemetryInfo?.requestId;
					if (typeof rid === 'string') { reqIds.push(rid); }
				}
			}
			sessionRequests.push({ sessionId: parsed.state.sessionId, requests: reqIds });
			// Detailed per-turn telemetry/model statistics intentionally removed.
		}
		const scanDuration = Date.now() - started;
		const stats: EditStateScanStats = {
			totalStateFiles: results.length,
			totalTurns,
			scannedFiles: files.length,
			errorFiles,
			scanDuration,
			oldestSession,
			newestSession
		};
		this.logger.info(`Edit state scan: ${results.length} files, ${totalTurns} turns in ${scanDuration}ms`);
		return { results, stats, sessionRequests };
	}

	/** Start watching for new/modified edit state files */
	startWatching(callback: (result: EditStateScanResult) => void): void {
		if (!this.watcherOptions.enableWatching || this.isWatching) {
			return;
		}
		this.watcherCallbacks.push(callback);
		if (this.watcherCallbacks.length === 1) {
			this.setupFileWatcher();
		}
		this.isWatching = true;
		this.logger.info('Started watching for edit state file changes');
	}

	/** Stop watching */
	stopWatching(): void {
		if (!this.isWatching) {
			return;
		}
		this.watcherCallbacks = [];
		if (this.fileWatcher) {
			this.fileWatcher.dispose();
			this.fileWatcher = undefined;
		}
		this.isWatching = false;
		this.logger.info('Stopped watching for edit state file changes');
	}

	/** Setup file system watcher */
	private setupFileWatcher(): void {
		const pattern = new vscode.RelativePattern(
			vscode.workspace.workspaceFolders?.[0] || vscode.Uri.file(os.homedir()),
			'**/chatEditingSessions/*/state.json'
		);
		this.fileWatcher = new ForceFileWatcher(
			pattern,
			0,
			3000 // Mirror ChatSessionScanner heavy debounce
		);
		let debounceTimer: NodeJS.Timeout | undefined;
		const handleFileChange = async (uri: vscode.Uri) => {
			if (debounceTimer) {
				clearTimeout(debounceTimer);
			}
			debounceTimer = setTimeout(async () => {
				try {
					const result = await this.parseEditStateFile(uri.fsPath);
					if (result) {
						this.watcherCallbacks.forEach(cb => cb(result));
					}
				} catch (error) {
					this.logger.error(`Error handling edit state file change ${uri.fsPath}: ${error}`);
				}
			}, this.watcherOptions.debounceMs);
		};
		this.fileWatcher.onDidCreate(handleFileChange);
		this.fileWatcher.onDidChange(handleFileChange);
		this.fileWatcher.start();
	}

	getWatcherStatus(): { isWatching: boolean; callbackCount: number } {
		return { isWatching: this.isWatching, callbackCount: this.watcherCallbacks.length };
	}

	getLastUsedStoragePaths(): string[] {
		return [...this.lastUsedStoragePaths];
	}

	async getWorkspaceInfo(storagePaths?: string[]): Promise<{ workspaces: any[]; totalStateFiles: number }> {
		const pathsToUse = storagePaths || this.lastUsedStoragePaths;
		const workspaces: any[] = [];
		let totalStateFiles = 0;
		for (const storagePath of pathsToUse) {
			try {
				await fs.access(storagePath);
				const workspaceDirs = await fs.readdir(storagePath, { withFileTypes: true });
				for (const workspaceDir of workspaceDirs) {
					if (!workspaceDir.isDirectory()) {
						continue;
					}
					const editingSessionsPath = path.join(storagePath, workspaceDir.name, EDIT_STATE_SCAN_CONSTANTS.EDITING_SESSIONS_DIR);
					try {
						await fs.access(editingSessionsPath);
						const dirs = await fs.readdir(editingSessionsPath);
						const stateFiles = await Promise.all(
							dirs.map(async d => {
								const candidate = path.join(editingSessionsPath, d, EDIT_STATE_SCAN_CONSTANTS.STATE_FILE_NAME);
								try { await fs.access(candidate); return candidate; } catch { return null; }
							})
						);
						const valid = stateFiles.filter(f => f !== null) as string[];
						workspaces.push({
							hash: workspaceDir.name,
							storagePath,
							editingSessionsPath,
							stateFileCount: valid.length,
							edition: storagePath.includes('Insiders') ? 'VS Code Insiders' : 'VS Code Stable'
						});
						totalStateFiles += valid.length;
					} catch { continue; }
				}
			} catch (error) {
				this.logger.error(`Error scanning edit state workspace info for ${storagePath}: ${error}`);
			}
		}
		return { workspaces, totalStateFiles };
	}

	dispose(): void {
		this.stopWatching();
	}
}
