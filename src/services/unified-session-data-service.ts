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
import { EditStateScanner } from '../scanning/edit-state-scanner';
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
		private readonly editStateScanner?: EditStateScanner // optional integration
	) {
		// All dependencies are now injected - no construction here
	}

	/** Optional access to edit state scanner */
	public getEditStateScanner(): EditStateScanner | undefined { return this.editStateScanner; }

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

			// Feed initial events to analytics service if available
			try {
				// Lazy import to avoid circular deps
				const { ServiceContainer } = await import('../types/service-container.js');
				if (ServiceContainer.isInitialized()) {
					const analytics = ServiceContainer.getInstance().getAnalyticsService();
					analytics.ingest(scanResult.sessionEvents, { replace: true });
				}
			} catch (e) {
				this.logger.debug(`Analytics ingestion (init) skipped: ${e}`);
			}
            
			if (this.options.enableRealTimeUpdates) {
				this.startRealTimeUpdates();
			}
            
			this.isInitialized = true;
			this.logger.info(`Initialized with ${scanResult.sessionEvents.length} session events, ${scanResult.logEntries.length} log entries (historical logs loaded: ${this.historicalLogsLoaded})`);
			return scanResult;
		});
	}

	/**
	 * Perform a one-time historical global log scan and merge results into cachedLogEntries.
	 * Safe to call multiple times; subsequent calls are no-ops unless force=true.
	 */
	async loadHistoricalLogs(force = false): Promise<number> {
		if (!this.logScanner) {
			this.logger.warn('Historical log load skipped: no global log scanner available');
			return 0;
		}
		if (this.historicalLogsLoaded && !force) {
			return 0;
		}
		try {
			this.logger.info('Loading historical global Copilot logs...');
			const result = await this.logScanner.scanAllHistoricalLogs();
			const before = this.cachedLogEntries.length;
			// Deduplicate while merging
			const existingKey = new Set(this.cachedLogEntries.map(e => `${e.requestId}|${e.timestamp.getTime()}`));
			for (const entry of result.logEntries) {
				const key = `${entry.requestId}|${entry.timestamp.getTime()}`;
				if (!existingKey.has(key)) {
					this.cachedLogEntries.push(entry);
					existingKey.add(key);
				}
			}
			this.cachedLogEntries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
			this.historicalLogsLoaded = true;
			const added = this.cachedLogEntries.length - before;
			this.logger.info(`Historical log load complete: added ${added} new log entries (total ${this.cachedLogEntries.length}).`);
			return added;
		} catch (err) {
			this.logger.error(`Historical log load failed: ${err}`);
			return 0;
		}
	}

	/**
	 * Produce per-day counts of session requests vs log entries for last N days (default 3).
	 * This triggers a fresh session scan to get authoritative request counts, and (if not yet loaded)
	 * loads historical logs before counting log entries.
	 */
	async getDailyRequestComparison(days = 3): Promise<Array<{ date: string; sessionRequests: number; logEntries: number }>> {
		if (days < 1) { days = 1; }
		// Ensure historical logs included
		await this.loadHistoricalLogs(false);
		// Fresh scan of sessions to get raw request timestamps
		const { results } = await this.sessionScanner.scanAllSessions();
		// Build date buckets
		const today = new Date();
		const targetDates: string[] = [];
		for (let i = 0; i < days; i++) {
			const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
			targetDates.push(d.toISOString().slice(0, 10)); // YYYY-MM-DD
		}
		const sessionCounts = new Map<string, number>();
		const logCounts = new Map<string, number>();
		for (const ts of targetDates) { sessionCounts.set(ts, 0); logCounts.set(ts, 0); }
		// Session requests
		for (const r of results) {
			for (const req of r.session.requests) {
				const dateStr = new Date(req.timestamp).toISOString().slice(0, 10);
				if (sessionCounts.has(dateStr)) {
					sessionCounts.set(dateStr, (sessionCounts.get(dateStr) || 0) + 1);
				}
			}
		}
		// Log entries (cached)
		for (const entry of this.cachedLogEntries) {
			const dateStr = entry.timestamp.toISOString().slice(0, 10);
			if (logCounts.has(dateStr)) {
				logCounts.set(dateStr, (logCounts.get(dateStr) || 0) + 1);
			}
		}
		return targetDates.map(date => ({
			date,
			sessionRequests: sessionCounts.get(date) || 0,
			logEntries: logCounts.get(date) || 0
		}));
	}

	/**
	 * Brute-force daily correlation between session requests (turns), log request entries, and edit state turns.
	 * We attempt to attribute each edit state turn to a date using any timestamp-like field; fallback to file mtime.
	 */
	async getDailyTurnRequestCorrelation(days = 7): Promise<Array<{
		date: string;
		sessionRequests: number;
		logEntries: number;
		editStateTurns: number;
		logCoveragePct: number;
		turnsPerRequest: number;
		missingLogRequests: number;
	}>> {
		if (days < 1) { days = 1; }
		await this.loadHistoricalLogs(false);
		const { results: sessionResults } = await this.sessionScanner.scanAllSessions();
		let editStateResults: any[] = [];
		if (this.editStateScanner) {
			const { results } = await this.editStateScanner.scanAllEditStates();
			editStateResults = results;
		}
		const today = new Date();
		const targetDates: string[] = [];
		for (let i = 0; i < days; i++) {
			const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
			targetDates.push(d.toISOString().slice(0, 10));
		}
		const sessionCounts = new Map<string, number>();
		const logCounts = new Map<string, number>();
		const editTurnCounts = new Map<string, number>();
		for (const d of targetDates) { sessionCounts.set(d, 0); logCounts.set(d, 0); editTurnCounts.set(d, 0); }
		// Session requests
		for (const r of sessionResults) {
			for (const req of r.session.requests) {
				const ds = new Date(req.timestamp).toISOString().slice(0, 10);
				if (sessionCounts.has(ds)) {
					sessionCounts.set(ds, (sessionCounts.get(ds) || 0) + 1);
				}
			}
		}
		// Log entries
		for (const e of this.cachedLogEntries) {
			const ds = e.timestamp.toISOString().slice(0, 10);
			if (logCounts.has(ds)) {
				logCounts.set(ds, (logCounts.get(ds) || 0) + 1);
			}
		}
		// Edit state turns
		for (const es of editStateResults) {
			// Attempt per-turn timestamps
			const turns = Array.isArray(es.state.linearHistory) ? es.state.linearHistory : [];
			let anyTimestamp = false;
			for (const t of turns) {
				if (t && typeof t === 'object') {
					let ts: any = (t.timestamp ?? t.time ?? t.date ?? t.createdAt ?? t.updatedAt);
					if (typeof ts === 'number') { ts = new Date(ts); }
					else if (typeof ts === 'string') { const parsed = Date.parse(ts); if (!isNaN(parsed)) { ts = new Date(parsed); } else { ts = null; } }
					if (ts instanceof Date && !isNaN(ts.getTime())) {
						const ds = ts.toISOString().slice(0, 10);
						if (editTurnCounts.has(ds)) {
							editTurnCounts.set(ds, (editTurnCounts.get(ds) || 0) + 1);
						}
						anyTimestamp = true;
					}
				}
			}
			if (!anyTimestamp) {
				// Fallback: attribute all turns to file mtime day
				const ds = es.lastModified.toISOString().slice(0, 10);
				if (editTurnCounts.has(ds)) {
					editTurnCounts.set(ds, (editTurnCounts.get(ds) || 0) + turns.length);
				}
			}
		}
		return targetDates.map(d => {
			const sr = sessionCounts.get(d) || 0;
			const lr = logCounts.get(d) || 0;
			const et = editTurnCounts.get(d) || 0;
			return {
				date: d,
				sessionRequests: sr,
				logEntries: lr,
				editStateTurns: et,
				logCoveragePct: sr > 0 ? +( (lr / sr) * 100 ).toFixed(1) : 0,
				turnsPerRequest: sr > 0 ? +( (et / sr) ).toFixed(2) : 0,
				missingLogRequests: sr - lr
			};
		});
	}

	/** Log the daily turn/request correlation */
	async logDailyTurnRequestCorrelation(days = 7): Promise<void> {
		const rows = await this.getDailyTurnRequestCorrelation(days);
		this.logger.info(`Daily Turn/Request Correlation (last ${days} day(s))`);
		this.logger.info('DATE | sessionRequests | logEntries | editStateTurns | logCoverage% | turnsPerRequest | missingLogRequests');
		for (const r of rows) {
			this.logger.info(`${r.date} | ${r.sessionRequests} | ${r.logEntries} | ${r.editStateTurns} | ${r.logCoveragePct}% | ${r.turnsPerRequest} | ${r.missingLogRequests}`);
		}
	}

	/** Log comparison report to logger */
	async logRecentDailyComparison(days = 3): Promise<void> {
		const rows = await this.getDailyRequestComparison(days);
		this.logger.info(`Daily request comparison (last ${days} day(s)) - historical logs loaded: ${this.historicalLogsLoaded}`);
		for (const row of rows) {
			this.logger.info(`${row.date}: ${row.sessionRequests} requests from sessions, ${row.logEntries} entries from logs`);
		}
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
				let editStateIndex: Map<string, string[]> | undefined;
				if (this.editStateScanner) {
					try {
						const { sessionRequests } = await this.editStateScanner.scanAllEditStates();
						editStateIndex = new Map(sessionRequests.map(r => [r.sessionId, r.requests]));
						this.logger.trace(`Edit state integration: indexed ${sessionRequests.length} edit state session(s)`);
					} catch (e) {
						this.logger.debug(`Edit state scan failed (non-fatal): ${e}`);
					}
				}
				// Attach edit state request sequences to matching sessions
				if (editStateIndex && editStateIndex.size > 0) {
					for (const sessionResult of results) {
						const seq = editStateIndex.get(sessionResult.session.sessionId);
						if (seq && seq.length > 0) {
							(sessionResult.session as any).editStateRequestIds = seq;
						}
					}
					this.logger.trace(`Edit state integration: attached sequences to ${results.filter(r => r.session.editStateRequestIds).length} session(s)`);
					const missingEditReq = results.filter(r => !(r.session as any).editStateRequestIds).length;
					this.logger.info(`Sessions lacking edit request IDs: ${missingEditReq}`);
					if (missingEditReq > 0) {
						const missingSessions = results.filter(r => !(r.session as any).editStateRequestIds);
						this.logger.info(`Missing edit request sessions dump (${missingSessions.length}) BEGIN`);
						for (const r of missingSessions) {
							try {
								const json = JSON.stringify(r.session);
								const truncated = json.length > 1000 ? json.slice(0, 1000) + `… (truncated, totalLength=${json.length})` : json;
								this.logger.info(`SESSION ${r.session.sessionId}: ${truncated}`);
							} catch (e) {
								this.logger.error(`Failed to stringify session ${r.session.sessionId}: ${e}`);
							}
						}
						this.logger.info('Missing edit request sessions dump END');
					}
				}
				
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
     * Get current log entries (real-time request-level data)
     */
	async getLogEntries(forceRefresh = false): Promise<LogEntry[]> {
		if (forceRefresh || this.cachedLogEntries.length === 0) {
			const { logEntries } = await this.scanAllData();
			return logEntries;
		}
		return this.cachedLogEntries;
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

				// Notify raw session result callbacks
				this.logger.trace(`REAL-TIME  Notifying ${this.rawSessionCallbacks.length} raw session callbacks`);
				this.rawSessionCallbacks.forEach((callback, index) => {
					try {
						this.logger.trace(`REAL-TIME  Calling raw session callback ${index + 1}/${this.rawSessionCallbacks.length}`);
						callback(this.cachedRawSessionResults);
					} catch (error) {
						this.logger.error(`Raw session callback error: ${error}`);
					}
				});

				// Incremental analytics ingest
				try {
					const { ServiceContainer } = await import('../types/service-container.js');
					if (ServiceContainer.isInitialized()) {
						const analytics = ServiceContainer.getInstance().getAnalyticsService();
						analytics.ingest(newEvents, { replace: false });
					}
				} catch (e) {
					this.logger.debug(`Analytics ingestion (update) skipped: ${e}`);
				}
                
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
     * Force refresh current log entries (useful for testing)
     */
	async refreshLogEntries(): Promise<LogEntry[]> {
		return this.getLogEntries(true);
	}

	/**
	 * Get raw session scan results (for analytics that need access to original session data)
	 */
	async getSessionScanResults(): Promise<SessionScanResult[]> {
		// Scan all sessions and return the raw results
		const { results } = await this.sessionScanner.scanAllSessions();
		return results;
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
