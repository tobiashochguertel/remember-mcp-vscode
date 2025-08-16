/**
 * Unified Session Data Service - Dual-stream data provider for Copilot events
 * Provides two distinct event streams:
 * 1. Session Events: Complete turn-based data from session JSON files  
 * 2. Log Events: Real-time request-level data from log files
 */

import { Mutex } from 'async-mutex';
import { CopilotUsageEvent } from '../types/usage-events';
import { ChatSessionScanner } from '../scanning/chat-session-scanner';
import { SessionDataTransformer } from './session-data-transformer';
// Switched from CopilotLogScanner to GlobalLogScanner for unified log monitoring
import { GlobalLogScanner } from '../scanning/global-log-scanner';
import { LogEntry } from '../scanning/log-types';
import { SessionScanResult, SessionScanStats } from '../types/chat-session';
// Removed debug unified counts feature; edit state scanner still optionally injected but no public debug method now.
import { ILogger } from '../types/logger';

export interface SessionDataServiceOptions {
	enableRealTimeUpdates?: boolean;
	debounceMs?: number;
	// Backward/forward compatibility: some callers may still specify window log scanning toggle
	enableWindowLogScanning?: boolean; // deprecated/no-op for now
}

export class UnifiedSessionDataService {
	private isWatchingEnabled = false;
	private isInitialized = false;

	// Public access to scanners (injected dependencies)
	public get chatSessionScanner(): ChatSessionScanner { return this.sessionScanner; }
	// Access to global log scanner (replaces former copilotLogScanner)
	public get globalLogScanner(): GlobalLogScanner | undefined { return this.logScanner; }
    
	// Mutexes to prevent race conditions
	private initializationMutex = new Mutex();
	private scanMutex = new Mutex();
	private sessionUpdateMutex = new Mutex();
    
	// Separate callback arrays for different event types
	private sessionEventCallbacks: Array<(events: CopilotUsageEvent[]) => void> = [];
	private logEventCallbacks: Array<(entries: LogEntry[]) => void> = [];
	private rawSessionCallbacks: Array<(results: SessionScanResult[]) => void> = [];
    
	// Separate caches for different data types
	private cachedSessionEvents: CopilotUsageEvent[] = [];
	private cachedLogEntries: LogEntry[] = [];
	private cachedRawSessionResults: SessionScanResult[] = [];
	private lastScanStats?: SessionScanStats;
	private historicalLogsLoaded = false;
	// Single-flight promise to coalesce concurrent full scans (prevents double scan during startup)
	private currentScanPromise?: Promise<{ sessionEvents: CopilotUsageEvent[]; logEntries: LogEntry[]; stats: SessionScanStats }>;

	/** Indicates whether historical global logs were loaded into cache */
	isHistoricalLogsLoaded(): boolean { return this.historicalLogsLoaded; }

	constructor(
		private readonly sessionScanner: ChatSessionScanner,
		private readonly logScanner: GlobalLogScanner | undefined,
		private readonly sessionTransformer: SessionDataTransformer,
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
	async initialize(): Promise<{ sessionEvents: CopilotUsageEvent[]; logEntries: LogEntry[]; stats: SessionScanStats }> {
		return await this.initializationMutex.runExclusive(async () => {
			if (this.isInitialized) {
				this.logger.trace('Already initialized, returning cached data');
				return {
					sessionEvents: this.cachedSessionEvents,
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
			this.logger.info(`Initialized with ${scanResult.sessionEvents.length} session events, ${scanResult.logEntries.length} log entries (historical logs loaded: ${this.historicalLogsLoaded})`);
			return scanResult;
		});
	}

	/**
     * Scan all session files and log files separately
     * Protected against concurrent scans with mutex
     */
	async scanAllData(): Promise<{ sessionEvents: CopilotUsageEvent[]; logEntries: LogEntry[]; stats: SessionScanStats }> {
		// If a scan is already in flight, return its promise (single-flight behavior)
		if (this.currentScanPromise) {
			return this.currentScanPromise;
		}
		this.currentScanPromise = this.scanMutex.runExclusive(async () => {
			try {
				// Scan session files
				const { results, stats } = await this.sessionScanner.scanAllSessions();
				// Count sessions that have an empty requests array (no turns)
				const emptyRequestSessions = results.reduce((acc, r) => acc + (r.session.requests.length === 0 ? 1 : 0), 0);
				this.logger.info(`Empty request sessions: ${emptyRequestSessions}`);
				// Optionally scan edit state timelines and index requestId sequences by sessionId				
				
				// Transform session data to events
				const sessionEvents: CopilotUsageEvent[] = [];
				for (const sessionResult of results) {
					const events = await this.sessionTransformer.transformSessionToEvents(sessionResult);
					sessionEvents.push(...events);
				}

				// Edit correlation summary
				try {
					const editLinked = sessionEvents.filter(e => e.isInEdit).length;
					const total = sessionEvents.length;
					const pct = total > 0 ? ((editLinked / total) * 100).toFixed(1) : '0.0';
					this.logger.info(`Edit correlation: ${editLinked}/${total} (${pct}%) events linked to edit state; ${total - editLinked} without edit linkage`);

					// Breakdown of missing edit linkage
					const missing = sessionEvents.filter(e => !e.isInEdit);
					if (missing.length > 0) {
						const countsByType = new Map<string, number>();
						for (const ev of missing) {
							countsByType.set(ev.type, (countsByType.get(ev.type) || 0) + 1);
						}
						this.logger.info(`Missing edit linkage by event type: ${[...countsByType.entries()].map(([t,c]) => `${t}:${c}`).join(', ')}`);
						const countsByMode = new Map<string, number>();
						for (const ev of missing) {
							const modeKey = ev.modes && ev.modes.length > 0 ? ev.modes[0] : 'none';
							countsByMode.set(modeKey, (countsByMode.get(modeKey) || 0) + 1);
						}
						this.logger.info(`Missing edit linkage by mode: ${[...countsByMode.entries()].map(([m,c]) => `${m}:${c}`).join(', ')}`);
						if (countsByMode.has('none')) {
							const missingModeEvents = missing.filter(ev => !ev.modes || ev.modes.length === 0);
							const agentCounts = new Map<string, number>();
							const sourceCounts = new Map<string, number>();
							for (const ev of missingModeEvents) {
								agentCounts.set(ev.agent || 'no-agent', (agentCounts.get(ev.agent || 'no-agent') || 0) + 1);
								sourceCounts.set(ev.source, (sourceCounts.get(ev.source) || 0) + 1);
							}
							const sampleReqIds = missingModeEvents.map(e => e.requestId).filter(Boolean).slice(0, 8).join(', ');
							this.logger.info(
								`Mode diagnostics (none bucket): events=${missingModeEvents.length}; agents=${[...agentCounts.entries()].map(([a,c]) => `${a}:${c}`).join(', ')}; sources=${[...sourceCounts.entries()].map(([s,c]) => `${s}:${c}`).join(', ')}; sampleRequestIds=${sampleReqIds || 'n/a'}`
							);
						}
						for (const [t] of countsByType.entries()) {
							const sampleSessions = Array.from(new Set(missing.filter(e => e.type === t).map(e => e.sessionId))).slice(0, 5);
							this.logger.trace(`Missing edit linkage sample sessions for type ${t}: ${sampleSessions.join(', ') || 'none'}`);
						}
					}
				} catch (e) {
					this.logger.debug(`Edit correlation summary failed: ${e}`);
				}

				// Sort session events by timestamp
				sessionEvents.sort((a: CopilotUsageEvent, b: CopilotUsageEvent) => a.timestamp.getTime() - b.timestamp.getTime());
				const logEntries: LogEntry[] = [];
				this.cachedSessionEvents = sessionEvents;
				this.cachedLogEntries = logEntries;
				this.cachedRawSessionResults = results;
				this.lastScanStats = stats;
				this.logger.trace(`Scanned ${results.length} sessions, generated ${sessionEvents.length} session events and ${logEntries.length} log entries`);
				return { sessionEvents, logEntries, stats };
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
     * Get current session events (complete turn-based data)
     */
	async getSessionEvents(forceRefresh = false): Promise<CopilotUsageEvent[]> {
		if (forceRefresh || this.cachedSessionEvents.length === 0) {
			const { sessionEvents } = await this.scanAllData();
			return sessionEvents;
		}
		return this.cachedSessionEvents;
	}

	/**
     * Get current raw session scan results (untampered session data with toolCallRounds)
     */
	async getRawSessionResults(forceRefresh = false): Promise<SessionScanResult[]> {
		if (forceRefresh || this.cachedRawSessionResults.length === 0) {
			const { results } = await this.sessionScanner.scanAllSessions();
			this.cachedRawSessionResults = results;
			return results;
		}
		return this.cachedRawSessionResults;
	}

	/**
     * Get last scan statistics
     */
	getLastScanStats(): SessionScanStats | undefined {
		return this.lastScanStats;
	}


	/**
     * Subscribe to session event updates (complete turn-based data)
     */
	onSessionEventsUpdated(callback: (events: CopilotUsageEvent[]) => void): void {
		this.sessionEventCallbacks.push(callback);
		this.logger.trace(`Session callback added - now have ${this.sessionEventCallbacks.length} callbacks`);
	}

	/**
     * Subscribe to log entry updates (real-time request-level data)
     */
	onLogEntriesUpdated(callback: (entries: LogEntry[]) => void): void {
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
     * Remove session event callback
     */
	removeSessionEventCallback(callback: (events: CopilotUsageEvent[]) => void): void {
		const index = this.sessionEventCallbacks.indexOf(callback);
		if (index > -1) {
			this.sessionEventCallbacks.splice(index, 1);
		}
	}

	/**
     * Remove log entry callback
     */
	removeLogEventCallback(callback: (entries: LogEntry[]) => void): void {
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
		this.logger.info(`Starting session file watching with ${this.sessionEventCallbacks.length} callbacks`);
		this.sessionScanner.startWatching(async (sessionResult: SessionScanResult) => {
			try {
				this.logger.trace(`REAL-TIME  Received session ${sessionResult.session.sessionId}`);
                
				// Transform new/updated session to events
				const newEvents = await this.sessionTransformer.transformSessionToEvents(sessionResult);
				this.logger.trace(`REAL-TIME  Transformed to ${newEvents.length} events`);
                
				// Update cached session events (replace events from same session) - protected by mutex
				await this.sessionUpdateMutex.runExclusive(async () => {
					const beforeCount = this.cachedSessionEvents.length;
					this.cachedSessionEvents = this.cachedSessionEvents.filter(
						(event: CopilotUsageEvent) => event.sessionId !== sessionResult.session.sessionId
					);
					this.cachedSessionEvents.push(...newEvents);
                    
					// Also update cached raw session results (replace session with same sessionId)
					const beforeRawCount = this.cachedRawSessionResults.length;
					this.cachedRawSessionResults = this.cachedRawSessionResults.filter(
						(result: SessionScanResult) => result.session.sessionId !== sessionResult.session.sessionId
					);
					this.cachedRawSessionResults.push(sessionResult);
                    
					// Sort by timestamp
					this.cachedSessionEvents.sort((a: CopilotUsageEvent, b: CopilotUsageEvent) => a.timestamp.getTime() - b.timestamp.getTime());
					this.cachedRawSessionResults.sort((a: SessionScanResult, b: SessionScanResult) => 
						new Date(a.session.creationDate).getTime() - new Date(b.session.creationDate).getTime()
					);
                    
					this.logger.trace(`REAL-TIME  Cache updated from ${beforeCount} to ${this.cachedSessionEvents.length} events, ${beforeRawCount} to ${this.cachedRawSessionResults.length} raw sessions`);
				});
                
				// Notify session event callbacks
				this.logger.trace(`REAL-TIME  Notifying ${this.sessionEventCallbacks.length} callbacks`);
				this.sessionEventCallbacks.forEach((callback, index) => {
					try {
						this.logger.trace(`REAL-TIME  Calling callback ${index + 1}/${this.sessionEventCallbacks.length}`);
						callback(this.cachedSessionEvents);
					} catch (error) {
						this.logger.error(` ${error}`);
					}
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
                
				this.logger.info(`REAL-TIME  Session update complete - ${newEvents.length} events from session ${sessionResult.session.sessionId}`);
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
	stopRealTimeUpdates(): void {
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
	getWatcherStatus(): { 
		isWatching: boolean; 
		sessionCallbackCount: number; 
		logCallbackCount: number;
		rawSessionCallbackCount: number;
	} {
		return {
			isWatching: this.isWatchingEnabled,
			sessionCallbackCount: this.sessionEventCallbacks.length,
			logCallbackCount: this.logEventCallbacks.length,
			rawSessionCallbackCount: this.rawSessionCallbacks.length
		};
	}

	/**
     * Force refresh current session events (useful for testing)
     */
	async refreshSessionEvents(): Promise<CopilotUsageEvent[]> {
		return this.getSessionEvents(true);
	}

	/**
     * Clean up resources
     */
	dispose(): void {
		this.stopRealTimeUpdates();
		this.sessionEventCallbacks = [];
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
	async resetInitialization(): Promise<void> {
		await this.initializationMutex.runExclusive(async () => {
			this.isInitialized = false;
			this.stopRealTimeUpdates();
			this.logger.debug('Initialization state reset');
		});
	}
}
