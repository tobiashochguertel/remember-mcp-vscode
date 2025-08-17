/**
 * Unified Session Data Service - Dual-stream data provider for Copilot events
 * Provides two distinct event streams:
 * 1. Session Events: Complete turn-based data from session JSON files  
 * 2. Log Events: Real-time request-level data from log files
 */

import { Mutex } from 'async-mutex';
import { ChatSessionScanner } from '../scanning/chat-session-scanner';
import { GlobalLogScanner } from '../scanning/global-log-scanner';
import { LogEntry } from '../scanning/log-types';
import { SessionScanResult, SessionScanStats } from '../types/chat-session';
import { ILogger } from '../types/logger';

export interface SessionDataServiceOptions {
	enableRealTimeUpdates?: boolean;
	debounceMs?: number;
	// Backward/forward compatibility: some callers may still specify window log scanning toggle
	enableWindowLogScanning?: boolean;
}

export class UnifiedSessionDataService {
	private isWatchingEnabled = false;
	private isInitialized = false;

	// Access to scanners (internal)
	private get chatSessionScanner(): ChatSessionScanner { return this.sessionScanner; }
	private get globalLogScanner(): GlobalLogScanner | undefined { return this.logScanner; }
    
	// Mutexes to prevent race conditions
	private initializationMutex = new Mutex();
	private scanMutex = new Mutex();
	private sessionUpdateMutex = new Mutex();
    
	// Separate callback arrays for different event types
	private logEventCallbacks: Array<(entries: LogEntry[]) => void> = [];
	private rawSessionCallbacks: Array<(results: SessionScanResult[]) => void> = [];
    
	// Separate caches for different data types
	private cachedLogEntries: LogEntry[] = [];
	private cachedRawSessionResults: SessionScanResult[] = [];
	private lastScanStats?: SessionScanStats;
	private historicalLogsLoaded = false;
	// Single-flight promise to coalesce concurrent full scans (prevents double scan during startup)
	private currentScanPromise?: Promise<{ results: SessionScanResult[]; logEntries: LogEntry[]; stats: SessionScanStats }>;

	public isScanning = false;

	/** Indicates whether historical global logs were loaded into cache */
	private isHistoricalLogsLoaded(): boolean { return this.historicalLogsLoaded; }

	constructor(
		private readonly sessionScanner: ChatSessionScanner,
		private readonly logScanner: GlobalLogScanner | undefined,
		private readonly logger: ILogger,
		private readonly extensionVersion: string,
		private readonly options: SessionDataServiceOptions = {},
	) {
		// All dependencies are now injected - no construction here
	}

	/**
     * Initialize the service and perform initial data scan
     * Protected against race conditions with mutex
     */
	async initialize(): Promise<{ results: SessionScanResult[]; logEntries: LogEntry[]; stats: SessionScanStats }> {
		return await this.initializationMutex.runExclusive(async () => {
			if (this.isInitialized) {
				this.logger.trace('Already initialized, returning cached data');
				return {
					results: this.cachedRawSessionResults,
					logEntries: this.cachedLogEntries,
					stats: this.lastScanStats || {
						totalSessions: 0,
						totalRequests: 0,
						scannedFiles: 0,
						errorFiles: 0,
						scanDuration: 0
					}
				};
			}

			this.logger.debug('Initializing UnifiedSessionDataService...');
            
			const scanResult = await this.scanAllData();
           
			if (this.options.enableRealTimeUpdates) {
				this.startRealTimeUpdates();
			}
            
			this.isInitialized = true;
			this.logger.info(`Initialized with ${scanResult.results.length} raw sessions, ${scanResult.logEntries.length} log entries (historical logs loaded: ${this.historicalLogsLoaded})`);
			return scanResult;
		});
	}

	/**
     * Scan all session files and log files separately
     * Protected against concurrent scans with mutex
     */
	private async scanAllData(): Promise<{ results: SessionScanResult[]; logEntries: LogEntry[]; stats: SessionScanStats }> {
		// If a scan is already in flight, return its promise (single-flight behavior)
		if (this.currentScanPromise) {
			return this.currentScanPromise;
		}
		this.currentScanPromise = this.scanMutex.runExclusive(async () => {
			try {
				// Scan session files
				this.isScanning = true;
				const { results, stats } = await this.sessionScanner.scanAllSessions();
				this.isScanning = false;
				// Count sessions that have an empty requests array (no turns)
				const emptyRequestSessions = results.reduce((acc, r) => acc + (r.session.turns.length === 0 ? 1 : 0), 0);
				this.logger.info(`Empty request sessions: ${emptyRequestSessions}`);
				// Cache raw session results only; no event transformation
				this.cachedRawSessionResults = results;
				const logEntries: LogEntry[] = [];
				this.cachedLogEntries = logEntries;
				this.lastScanStats = stats;
				this.logger.info(`Scanned ${results.length} sessions; cached ${results.length} raw sessions and ${logEntries.length} log entries`);
				return { results, logEntries, stats };
			} catch (error) {
				this.logger.error(`Scan failed: ${error}`);
				throw error;
			} finally {
				// Allow new scans after current completes
				setTimeout(() => { this.currentScanPromise = undefined; }, 0);
			}
		});
		return this.currentScanPromise;
	}

	/**
	 * Get current raw session scan results (untampered session data with toolCallRounds)
	 * Performs a full scan only if the cache is empty; otherwise returns cached results.
	 */
	async getRawSessionResults(): Promise<SessionScanResult[]> {
		if (this.cachedRawSessionResults?.length === 0) {
			const { results } = await this.scanAllData();
			return results;
		}
		return this.cachedRawSessionResults;
	}

	/**
     * Get last scan statistics
     */
	private getLastScanStats(): SessionScanStats | undefined {
		return this.lastScanStats;
	}


	/**
     * Subscribe to log entry updates (real-time request-level data)
     */
	private onLogEntriesUpdated(callback: (entries: LogEntry[]) => void): void {
		this.logEventCallbacks.push(callback);
		this.logger.trace(`Log callback added - now have ${this.logEventCallbacks.length} callbacks`);
	}

	/**
     * Subscribe to raw session scan result updates (untampered session data with toolCallRounds)
     */
	onRawSessionResultsUpdated(callback: (results: SessionScanResult[]) => void): void {
		this.rawSessionCallbacks.push(callback);
		this.logger.trace(`Raw session callback added - now have ${this.rawSessionCallbacks.length} callbacks`);
	}

	/**
     * Remove log entry callback
     */
	private removeLogEventCallback(callback: (entries: LogEntry[]) => void): void {
		const index = this.logEventCallbacks.indexOf(callback);
		if (index > -1) {
			this.logEventCallbacks.splice(index, 1);
		}
	}

	/**
     * Remove raw session result callback
     */
	removeRawSessionCallback(callback: (results: SessionScanResult[]) => void): void {
		const index = this.rawSessionCallbacks.indexOf(callback);
		if (index > -1) {
			this.rawSessionCallbacks.splice(index, 1);
		}
	}

	/**
     * Start real-time monitoring for session file changes
     */
	private startRealTimeUpdates(): void {
		if (this.isWatchingEnabled) {
			return;
		}

		// Start watching session files
		this.logger.info(`Starting session file watching with ${this.rawSessionCallbacks.length} raw-session callbacks`);
		this.sessionScanner.startWatching(async (sessionResult: SessionScanResult) => {
			try {
				this.logger.trace(`REAL-TIME  Received session ${sessionResult.session.sessionId}`);
				
				// Update cached raw session results (replace session with same sessionId) - protected by mutex
				await this.sessionUpdateMutex.runExclusive(async () => {
					const beforeRawCount = this.cachedRawSessionResults.length;
					this.cachedRawSessionResults = this.cachedRawSessionResults.filter(
						(result: SessionScanResult) => result.session.sessionId !== sessionResult.session.sessionId
					);
					this.cachedRawSessionResults.push(sessionResult);
					
					// Sort by creationDate
					this.cachedRawSessionResults.sort((a: SessionScanResult, b: SessionScanResult) => 
						new Date(a.session.creationDate).getTime() - new Date(b.session.creationDate).getTime()
					);
					
					this.logger.trace(`REAL-TIME  Raw cache updated from ${beforeRawCount} to ${this.cachedRawSessionResults.length} sessions`);
				});

				// Notify raw session result callbacks with only the updated session (incremental)
				this.logger.trace(`REAL-TIME  Notifying ${this.rawSessionCallbacks.length} raw session callbacks with 1 updated session`);
				this.rawSessionCallbacks.forEach((callback, index) => {
					try {
						this.logger.trace(`REAL-TIME  Calling raw session callback ${index + 1}/${this.rawSessionCallbacks.length}`);
						callback([sessionResult]); // Send only the updated session, not entire cache
					} catch (error) {
						this.logger.error(`Raw session callback error: ${error}`);
					}
				});
				
				this.logger.info(`REAL-TIME  Session update complete for session ${sessionResult.session.sessionId}`);
			} catch (error) {
				this.logger.error(`Error processing session update: ${error}`);
			}
		});

		// Start watching global log files if enabled
		if (this.logScanner) {
			this.logger.info(`Starting GLOBAL log watching with ${this.logEventCallbacks.length} callbacks`);
			this.logScanner.onGlobalLogActivity(async (globalResult) => {
				try {
					this.logger.warn(`UNIFIED REAL-TIME GLOBAL  Received ${globalResult.logEntries.length} log entries`);
					if (globalResult.logEntries.length > 0) {
						const beforeCount = this.cachedLogEntries.length;
						// Deduplicate
						const newEntries = globalResult.logEntries.filter(newEntry =>
							!this.cachedLogEntries.some(existingEntry =>
								existingEntry.requestId === newEntry.requestId && existingEntry.timestamp.getTime() === newEntry.timestamp.getTime()
							)
						);
						if (newEntries.length > 0) {
							this.cachedLogEntries.push(...newEntries);
							this.cachedLogEntries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
							this.logger.trace(`REAL-TIME GLOBAL  Cache updated from ${beforeCount} to ${this.cachedLogEntries.length} entries (${newEntries.length} new)`);
							this.logger.trace(`REAL-TIME GLOBAL  Notifying ${this.logEventCallbacks.length} callbacks`);
							this.logEventCallbacks.forEach((callback, index) => {
								try {
									this.logger.trace(`REAL-TIME GLOBAL  Calling log callback ${index + 1}/${this.logEventCallbacks.length}`);
									callback(newEntries);
								} catch (error) {
									this.logger.error(` ${error}`);
								}
							});
						}
					}
					this.logger.info(`REAL-TIME GLOBAL  Log update complete - ${globalResult.logEntries.length} entries processed`);
				} catch (error) {
					this.logger.error(`Error processing global log update: ${error}`);
				}
			});
			this.logScanner.startGlobalWatching();
		}

		this.isWatchingEnabled = true;
		this.logger.info('Real-time updates enabled');
	}

	/**
     * Stop real-time monitoring
     */
	private stopRealTimeUpdates(): void {
		if (!this.isWatchingEnabled) {
			return;
		}

		this.sessionScanner.stopWatching();
		if (this.logScanner) {
			this.logScanner.stopGlobalWatching();
		}
		this.isWatchingEnabled = false;
		this.logger.info('Real-time updates disabled');
	}

	/**
     * Get watcher status
     */
	private getWatcherStatus(): { 
		isWatching: boolean; 
		logCallbackCount: number;
		rawSessionCallbackCount: number;
	} {
		return {
			isWatching: this.isWatchingEnabled,
			logCallbackCount: this.logEventCallbacks.length,
			rawSessionCallbackCount: this.rawSessionCallbacks.length
		};
	}

	/**
     * Clean up resources
     */
	dispose(): void {
		this.stopRealTimeUpdates();
		this.logEventCallbacks = [];
		this.rawSessionCallbacks = [];
		this.sessionScanner.dispose();
		if (this.logScanner) {
			this.logScanner.dispose();
		}
		this.isInitialized = false;
		this.logger.debug('Service disposed');
	}

	/**
     * Reset initialization state (for testing/debugging)
     * Protected against race conditions with mutex
     */
	private async resetInitialization(): Promise<void> {
		await this.initializationMutex.runExclusive(async () => {
			this.isInitialized = false;
			this.stopRealTimeUpdates();
			this.logger.debug('Initialization state reset');
		});
	}
}
