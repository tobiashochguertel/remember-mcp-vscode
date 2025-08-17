/**
 * Global Log Scanner - Scans ALL VS Code instances and sessions
 * 
 * PURPOSE: "Here's everything that happened across ALL VS Code instances on this machine"
 * 
 * Features:
 * - Scans all historical logs across all VS Code versions (Stable & Insiders)
 * - Monitors all log directories for cross-instance activity
 * - Emits global events for analytics and cross-session correlation
 * - Provides comprehensive machine-wide usage statistics
 */

import * as vscode from 'vscode';
import { ForceFileWatcher } from '../util/force-file-watcher';
import * as path from 'path';
import * as fs from 'fs/promises';
import { ILogger } from '../types/logger';
import { LogParsingUtils } from './log-parsing-utils';
import { LogPathDiscovery } from './log-path-discovery';
import { GlobalLogScanResult } from './log-types';

export class GlobalLogScanner {
	private globalWatchers: ForceFileWatcher[] = [];
	private globalEventCallbacks: Array<(result: GlobalLogScanResult) => void> = [];
	private isWatchingGlobally = false;
	// Track per-file incremental read positions
	private fileStates: Map<string, { lastPosition: number }> = new Map();
	private processingFiles: Set<string> = new Set();

	constructor(
		private readonly logger: ILogger
	) {}

	/**
	 * Comprehensive historical scan: Read and parse ALL log files across all sessions, all days, all VS Code versions
	 * This is the main method for historical data collection
	 */
	async scanAllHistoricalLogs(): Promise<GlobalLogScanResult> {
		const scanStartTime = new Date().toISOString();
		this.logger.info('GLOBAL: Starting comprehensive scan across ALL VS Code instances...');

		const allHistoricalLogs = await LogPathDiscovery.findAllHistoricalLogPaths();
		const allEntries: any[] = [];
		let totalInstancesScanned = 0;

		this.logger.debug(`GLOBAL: Found ${allHistoricalLogs.length} historical log files across all instances`);

		for (const { logPath, version, session } of allHistoricalLogs) {
			try {
				this.logger.trace(`GLOBAL: Processing ${version} session ${session}: ${logPath}`);
				const content = await LogParsingUtils.readFileContent(logPath);
				
				if (content.trim()) {
					const entries = LogParsingUtils.parseMultiLineRequests(content);
					
					// Add metadata to entries to track their source
					entries.forEach(entry => {
						entry.rawLine = `[${version}][${session}] ${entry.rawLine}`;
					});
					
					allEntries.push(...entries);
					totalInstancesScanned++;
					this.logger.trace(`GLOBAL: Found ${entries.length} entries in ${version} session ${session}`);
				}
			} catch (error) {
				this.logger.error(`GLOBAL: Error processing ${logPath}: ${error}`);
			}
		}

		// Sort by timestamp to get chronological order
		allEntries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

		const scanEndTime = new Date().toISOString();

		const result: GlobalLogScanResult = {
			logEntries: allEntries,
			scope: 'global',
			metadata: {
				vscodeVersion: 'mixed', // Multiple versions scanned
				sessionId: 'all-sessions',
				windowId: 'all-windows',
				totalInstancesScanned,
				scanStartTime,
				scanEndTime
			}
		};

		this.logger.info(`GLOBAL: Comprehensive scan complete - found ${allEntries.length} total entries across ${totalInstancesScanned} instances`);
		return result;
	}

	/**
	 * Start watching ALL log directories for cross-instance activity
	 * This monitors any changes in any VS Code instance on this machine
	 */
	async startGlobalWatching(): Promise<void> {
		if (this.isWatchingGlobally) {
			this.logger.trace('GLOBAL: Already watching globally, skipping');
			return;
		}

		//await this.setupGlobalFileWatchers();
	}

	/**
	 * Set up file watchers for ALL VS Code log directories
	 * This watches for changes in any VS Code instance (Stable & Insiders)
	 */
	private async setupGlobalFileWatchers(): Promise<void> {
		try {
			const logRoots = LogPathDiscovery.getVSCodeLogRootDirectories();
			this.logger.debug(`GLOBAL: Setting up watchers for ${logRoots.length} VS Code log root directories`);

			for (const logRoot of logRoots) {
				const versionName = logRoot.includes('Insiders') ? 'VS Code Insiders' : 'VS Code Stable';
				this.logger.trace(`GLOBAL: Setting up watcher for ${versionName}: ${logRoot}`);

				// Watch for any .log files in any subdirectory of this log root
				// Pattern: {logRoot}/**/**/GitHub.copilot-chat/*.log
				const pattern = new vscode.RelativePattern(logRoot, '**/exthost/**/GitHub.copilot-chat/*.log');

				const watcher = new ForceFileWatcher(
					pattern,
					2000, // Force flush every 2s for global monitoring
					1000  // Moderate debouncing (1s) for global events
				);

				watcher.onDidCreate(async (uri) => {
					const createdFile = uri.fsPath;
					this.logger.info(`GLOBAL: New log file created in ${versionName} - ${createdFile}`);
					// Initialize from start (not tail) so we capture initial existing contents
					await this.initializeFileState(createdFile, false /* from-start: capture initial file contents */);
					// Process immediately to emit any existing entries present at creation time
					await this.handleGlobalLogChange(createdFile, versionName);
				});

				watcher.onDidChange(async (uri) => {
					const changedFile = uri.fsPath;
					this.logger.trace(`GLOBAL: Log file changed in ${versionName} - ${changedFile}`);
					await this.handleGlobalLogChange(changedFile, versionName);
				});

				watcher.onDidDelete((uri) => {
					const deletedFile = uri.fsPath;
					this.logger.info(`GLOBAL: Log file deleted in ${versionName} - ${deletedFile}`);
					this.fileStates.delete(deletedFile);
					this.processingFiles.delete(deletedFile);
				});

				watcher.start();
				this.globalWatchers.push(watcher);
			}

			this.isWatchingGlobally = true;
			this.logger.info('GLOBAL: Successfully started global watching across ALL VS Code instances');
		} catch (error) {
			this.logger.error(`GLOBAL: Error setting up global watchers: ${error}`);
		}
	}

	/**
	 * Handle changes in any log file across all VS Code instances
	 */
	private async handleGlobalLogChange(logPath: string, versionName: string): Promise<void> {
		if (this.processingFiles.has(logPath)) {
			// Prevent overlapping reads; queue a follow-up lightweight pass
			setTimeout(() => this.handleGlobalLogChange(logPath, versionName).catch(() => {}), 200);
			return;
		}

		this.processingFiles.add(logPath);
		try {
			await this.ensureFileState(logPath);
			const newContent = await this.readNewContent(logPath);
			if (!newContent.trim()) {
				this.logger.trace(`GLOBAL: No new content for ${logPath}`);
				return;
			}

			// Extract session/window info from path
			const { sessionId, windowId } = this.extractPathMetadata(logPath);

			const entries = LogParsingUtils.parseMultiLineRequests(newContent);
			if (entries.length === 0) {
				this.logger.trace(`GLOBAL: Parsed 0 entries from incremental chunk (${newContent.length} bytes)`);
				return;
			}

			entries.forEach(entry => {
				entry.rawLine = `[${versionName}][${sessionId}][${windowId}] ${entry.rawLine}`;
			});

			const nowIso = new Date().toISOString();
			const result: GlobalLogScanResult = {
				logEntries: entries,
				scope: 'global',
				metadata: {
					vscodeVersion: versionName,
					sessionId,
					windowId,
					totalInstancesScanned: 1,
					scanStartTime: nowIso,
					scanEndTime: nowIso
				}
			};

			this.logger.info(`GLOBAL: Processing ${entries.length} incremental entries from ${versionName} ${sessionId}/${windowId}`);
			this.notifyGlobalCallbacks(result);
		} catch (error) {
			this.logger.error(`GLOBAL: Error handling incremental log change ${logPath}: ${error}`);
		} finally {
			this.processingFiles.delete(logPath);
		}
	}

	/** Ensure file state exists (tail mode by default) */
	private async ensureFileState(logPath: string): Promise<void> {
		if (!this.fileStates.has(logPath)) {
			await this.initializeFileState(logPath, true);
		}
	}

	/** Initialize per-file state. tailMode=true means start at EOF (skip historical). */
	private async initializeFileState(logPath: string, tailMode: boolean): Promise<void> {
		try {
			const stats = await fs.stat(logPath);
			const lastPosition = tailMode ? stats.size : 0;
			this.fileStates.set(logPath, { lastPosition });
			this.logger.trace(`GLOBAL: Initialized file state (${tailMode ? 'tail' : 'from-start'}) for ${logPath} at position ${lastPosition}`);
		} catch (error) {
			this.logger.error(`GLOBAL: Failed to initialize file state for ${logPath}: ${error}`);
		}
	}

	/** Incremental read of new content */
	private async readNewContent(logPath: string): Promise<string> {
		const state = this.fileStates.get(logPath);
		if (!state) {
			return '';
		}
		try {
			const stats = await fs.stat(logPath);
			if (stats.size < state.lastPosition) {
				this.logger.trace(`GLOBAL: Detected truncation/rotation for ${logPath} (size ${stats.size} < ${state.lastPosition}), resetting`);
				state.lastPosition = 0;
			}
			if (stats.size === state.lastPosition) {
				return '';
			}
			const newSize = stats.size - state.lastPosition;
			const fd = await fs.open(logPath, 'r');
			const buffer = Buffer.alloc(newSize);
			await fd.read(buffer, 0, newSize, state.lastPosition);
			await fd.close();
			state.lastPosition = stats.size;
			this.logger.trace(`GLOBAL: Incremental read ${newSize} bytes (new position ${state.lastPosition}) from ${logPath}`);
			return buffer.toString('utf-8');
		} catch (error) {
			this.logger.error(`GLOBAL: Error reading new content from ${logPath}: ${error}`);
			return '';
		}
	}

	/** Extract session/window identifiers from a log path */
	private extractPathMetadata(logPath: string): { sessionId: string; windowId: string } {
		const pathParts = logPath.split(path.sep);
		const sessionIndex = pathParts.findIndex(part => part.match(/^[\d]{8}T[\d]{6}$/));
		const sessionId = sessionIndex >= 0 ? pathParts[sessionIndex] : 'unknown';
		const windowIndex = pathParts.findIndex(part => part.startsWith('window'));
		const windowId = windowIndex >= 0 ? pathParts[windowIndex] : 'unknown';
		return { sessionId, windowId };
	}

	/**
	 * Stop global watching
	 */
	stopGlobalWatching(): void {
		if (!this.isWatchingGlobally) {
			return;
		}

		for (const watcher of this.globalWatchers) {
			watcher.dispose();
		}
		this.globalWatchers = [];
		this.isWatchingGlobally = false;
		this.logger.info('GLOBAL: Stopped global watching');
	}

	/**
	 * Register callback for global log events
	 * These events represent activity across ALL VS Code instances
	 */
	onGlobalLogActivity(callback: (result: GlobalLogScanResult) => void): void {
		this.globalEventCallbacks.push(callback);
		this.logger.trace(`GLOBAL: Registered callback - now have ${this.globalEventCallbacks.length} global callbacks`);
	}

	/**
	 * Remove global log callback
	 */
	removeGlobalCallback(callback: (result: GlobalLogScanResult) => void): void {
		const index = this.globalEventCallbacks.indexOf(callback);
		if (index > -1) {
			this.globalEventCallbacks.splice(index, 1);
			this.logger.trace(`GLOBAL: Removed callback - now have ${this.globalEventCallbacks.length} global callbacks`);
		}
	}

	/**
	 * Notify callbacks about global log activity
	 */
	private notifyGlobalCallbacks(result: GlobalLogScanResult): void {
		if (result.logEntries.length > 0 && this.globalEventCallbacks.length > 0) {
			this.logger.trace(`GLOBAL: Notifying ${this.globalEventCallbacks.length} callbacks about ${result.logEntries.length} global entries`);
			this.globalEventCallbacks.forEach((callback, index) => {
				try {
					callback(result);
				} catch (error) {
					this.logger.trace(`GLOBAL: Callback ${index + 1} error: ${error}`);
				}
			});
		}
	}

	/**
	 * Get global scanner status
	 */
	getGlobalStatus(): { 
		isWatchingGlobally: boolean; 
		watcherCount: number; 
		callbackCount: number;
		logRootCount: number;
		trackedFileCount: number;
	} {
		return {
			isWatchingGlobally: this.isWatchingGlobally,
			watcherCount: this.globalWatchers.length,
			callbackCount: this.globalEventCallbacks.length,
			logRootCount: LogPathDiscovery.getVSCodeLogRootDirectories().length,
			trackedFileCount: this.fileStates.size
		};
	}

	/**
	 * Cleanup resources
	 */
	dispose(): void {
		this.stopGlobalWatching();
		this.globalEventCallbacks = [];
		this.fileStates.clear();
		this.processingFiles.clear();
	}
}
