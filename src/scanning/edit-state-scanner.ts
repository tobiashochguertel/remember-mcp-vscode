/**
 * Edit State Scanner - Discovers and monitors VS Code chat editing state files
 * Mirrors ChatSessionScanner with minimal adaptation for editing state timelines.
 */

import * as vscode from 'vscode';
import { ForceFileWatcher } from '../util/force-file-watcher';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { EditStateFile, EditStateScanResult, EditStateScanStats, EditStateWatcherOptions, EDIT_STATE_SCAN_CONSTANTS } from '../types/edit-state';
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
		try {
			const stats = await fs.stat(filePath);
			const content = await fs.readFile(filePath, 'utf-8');
			const state: EditStateFile = JSON.parse(content);
			if (!this.isValidEditState(state)) {
				this.logger.error(`Invalid edit state structure in ${filePath}`);
				return null;
			}
			const result: EditStateScanResult = {
				stateFilePath: filePath,
				state,
				lastModified: stats.mtime,
				fileSize: stats.size
			};
			this.logger.debug(`Created EditStateScanResult for ${filePath}`);
			return result;
		} catch (error) {
			this.logger.error(`Error parsing edit state file ${filePath}: ${error}`);
			return null;
		}
	}

	/** Scan all editing state files */
	async scanAllEditStates(): Promise<{ results: EditStateScanResult[]; stats: EditStateScanStats }> {
		const startTime = Date.now();
		this.logger.info('Starting full edit state scan...');
		const allFiles = await this.findAllEditStateFiles();
		const results: EditStateScanResult[] = [];
		let errorFiles = 0;
		let totalTurns = 0;
		// Placeholder oldest/newest until we model timestamps (may derive from linearHistory later)
		let oldestSession: string | undefined;
		let newestSession: string | undefined;
		const batchSize = 50;
		for (let i = 0; i < allFiles.length; i += batchSize) {
			const batch = allFiles.slice(i, i + batchSize);
			const batchPromises = batch.map(async (filePath) => {
				const result = await this.parseEditStateFile(filePath);
				if (result) {
					if (Array.isArray(result.state.linearHistory)) {
						totalTurns += result.state.linearHistory.length;
					}
					return result;
				} else {
					errorFiles++;
					return null;
				}
			});
			const batchResults = await Promise.all(batchPromises);
			results.push(...batchResults.filter(r => r !== null) as EditStateScanResult[]);
		}
		const scanDuration = Date.now() - startTime;
		const stats: EditStateScanStats = {
			totalStateFiles: results.length,
			totalTurns,
			scannedFiles: allFiles.length,
			errorFiles,
			scanDuration,
			oldestSession,
			newestSession
		};
		this.logger.info(`Edit state scan complete: ${results.length} state files, ${totalTurns} turns in ${scanDuration}ms`);
		return { results, stats };
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

	/** Simple structural validation – permissive */
	private isValidEditState(obj: any): obj is EditStateFile {
		if (!obj) {
			return false;
		}
		if (typeof obj.version !== 'number') {
			this.logger.trace(`Invalid version: ${typeof obj.version}`);
			return false;
		}
		if (typeof obj.sessionId !== 'string') {
			this.logger.trace(`Invalid sessionId: ${typeof obj.sessionId}`);
			return false;
		}
		if (!Array.isArray(obj.linearHistory)) {
			this.logger.trace(`Invalid linearHistory: ${typeof obj.linearHistory}`);
			return false;
		}
		return true;
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
