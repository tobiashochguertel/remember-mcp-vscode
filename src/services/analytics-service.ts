import { ILogger } from '../types/logger';
import { SessionScanResult, CopilotChatTurn } from '../types/chat-session';
import { UnifiedSessionDataService } from './unified-session-data-service';

export type TimeRange = 'today' | '7d' | '30d' | '90d' | 'all';

export interface AnalyticsFilter {
	timeRange?: TimeRange;
	workspace?: 'current' | 'all';
	workspaceId?: string;
	agentIds?: string[];
	modelIds?: string[];
}

export interface Kpis {
	turns: number;
	sessions: number;
	files: number;
	edits: number;
	latencyMsMedian: number;
	editRatio: number;
	models: number;
	agents: number;
	requests: number;
}

export interface AgentStat {
	id: string;
	count: number;
	latencyMsMedian: number;
	editRatio: number;
	series7d: number[];
}

export interface ModelStat {
	id: string;
	count: number;
	tokensEst?: number;
	latencyMsMedian: number;
}

export interface LanguageStat {
	id: string;
	count: number;
}

export interface ActivityItem {
	timeISO: string;
	type: string;
	agent: string;
	model: string;
	file?: string;
	latencyMs?: number;
	sessionId: string;
	requestId: string;
}

export class AnalyticsService {
	// Raw session results are now the source of truth for analytics
	private rawSessions: SessionScanResult[] = [];
	private logger: ILogger;
	private unified: UnifiedSessionDataService;
	// Subscribers to analytics updates
	private analyticsCallbacks: Array<() => void> = [];

	constructor(logger: ILogger, unified: UnifiedSessionDataService) {
		this.logger = logger;
		this.unified = unified;
		// Hook into raw session data stream
		this.initializeRawSessionSource().catch(err => {
			this.logger.error(`Raw session init skipped: ${err}`);
		});
	}

	/** Subscribe to analytics updates (KPIs/agents/models/activity may have changed) */
	onAnalyticsUpdated(callback: () => void): void {
		this.analyticsCallbacks.push(callback);
	}

	/** Remove analytics update callback */
	removeAnalyticsCallback(callback: () => void): void {
		const i = this.analyticsCallbacks.indexOf(callback);
		if (i !== -1) {
			this.analyticsCallbacks.splice(i, 1);
		}
	}

	private emitAnalyticsUpdated(): void {
		if (this.analyticsCallbacks.length === 0) { return; }
		this.logger.trace?.(`AnalyticsService: notifying ${this.analyticsCallbacks.length} subscriber(s)`);
		for (const cb of this.analyticsCallbacks) {
			try { cb(); } catch (e) { this.logger.error?.(`Analytics callback error: ${e}`); }
		}
	}

	getKpis(filter?: AnalyticsFilter): Kpis {
		const turns = this.applyFilterToTurns(this.flattenTurns(), filter);
		const sessions = new Set(turns.map(r => r.sessionId)).size;
		const files = new Set(turns.map(r => r.filePath).filter(Boolean)).size;
		const models = new Set(turns.map(r => r.model).filter(Boolean)).size;
		const agents = new Set(turns.map(r => r.agent).filter(Boolean)).size;
		const latencies = turns.map(r => r.latencyMs).filter((v): v is number => typeof v === 'number' && !isNaN(v));
		const latencyMsMedian = this.median(latencies) ?? 0;
		const requests = turns.reduce((sum, r) => sum + (Array.isArray(r.modelRequests) ? r.modelRequests.length : 0), 0);

		// edits approximation: count requests with mode 'edit'
		const edits = turns.filter(r => r.type === 'edit').length;
		const turnCount = turns.length;
		const editRatio = turnCount > 0 ? edits / turnCount : 0;

		return { turns: turnCount, sessions, files, edits, latencyMsMedian, editRatio, models, agents, requests: requests };
	}

	getAgents(filter?: AnalyticsFilter, limit = 5): AgentStat[] {
		const reqs = this.applyFilterToTurns(this.flattenTurns(), filter);
		const byAgent = new Map<string, Array<typeof reqs[number]>>();
		for (const r of reqs) {
			const key = r.agent || 'unknown';
			const arr = byAgent.get(key) || [];
			arr.push(r);
			byAgent.set(key, arr);
		}
		const end = new Date();
		const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000);
		const days = this.enumerateDays(start, end);

		const stats: AgentStat[] = Array.from(byAgent.entries())
			.map(([id, arr]) => {
				const latencies = arr.map(e => e.latencyMs).filter((v): v is number => typeof v === 'number' && !isNaN(v));
				const latencyMsMedian = this.median(latencies) ?? 0;
				const edits = arr.filter(e => e.type === 'edit').length;
				const editRatio = arr.length > 0 ? edits / arr.length : 0;
				const series7d = days.map(d => arr.filter(e => e.timeISO.startsWith(d)).length);
				return { id, count: arr.length, latencyMsMedian, editRatio, series7d };
			})
			.sort((a, b) => b.count - a.count);

		return stats.slice(0, limit);
	}

	getModels(filter?: AnalyticsFilter, limit = 5): ModelStat[] {
		const reqs = this.applyFilterToTurns(this.flattenTurns(), filter);
		const byModel = new Map<string, Array<typeof reqs[number]>>();
		for (const r of reqs) {
			const key = r.model || 'unknown';
			const arr = byModel.get(key) || [];
			arr.push(r);
			byModel.set(key, arr);
		}
		const stats: ModelStat[] = Array.from(byModel.entries())
			.map(([id, arr]) => {
				const latencies = arr.map(e => e.latencyMs).filter((v): v is number => typeof v === 'number' && !isNaN(v));
				const latencyMsMedian = this.median(latencies) ?? 0;
				// Tokens not directly available in raw sessions; leave undefined
				return { id, count: arr.length, latencyMsMedian };
			})
			.sort((a, b) => b.count - a.count);
		return stats.slice(0, limit);
	}

	private getLanguages(filter?: AnalyticsFilter, limit = 10): LanguageStat[] {
		const reqs = this.applyFilterToTurns(this.flattenTurns(), filter);
		const byLang = new Map<string, number>();
		for (const r of reqs) {
			const key = (r.language && r.language.trim()) || 'unknown';
			byLang.set(key, (byLang.get(key) || 0) + 1);
		}
		const stats: LanguageStat[] = Array.from(byLang.entries())
			.map(([id, count]) => ({ id, count }))
			.sort((a, b) => b.count - a.count);
		return stats.slice(0, limit);
	}

	getActivity(filter?: AnalyticsFilter, limit = 20): ActivityItem[] {
		const reqs = this.applyFilterToTurns(this.flattenTurns(), filter);
		const items: ActivityItem[] = reqs
			.slice(-limit)
			.reverse()
			.map(r => ({
				timeISO: r.timeISO,
				type: r.type,
				agent: r.agent || 'unknown',
				model: r.model || 'unknown',
				file: r.filePath,
				latencyMs: r.latencyMs,
				sessionId: r.sessionId,
				requestId: r.turnId
			}));
		return items;
	}

	getDailyRequests(filter?: AnalyticsFilter): Array<{ date: string; requests: number }> {
		const reqs = this.applyFilterToTurns(this.flattenTurns(), filter);

		// Group only the already-filtered requests by day (YYYY-MM-DD)
		const countsByDate = new Map<string, number>();
		for (const r of reqs) {
			const date = r.timeISO.split('T')[0];
			countsByDate.set(date, (countsByDate.get(date) ?? 0) + 1);
		}

		// Return the days that actually have requests, sorted ascending
		const dates = Array.from(countsByDate.keys()).sort();
		return dates.map(date => ({ date, requests: countsByDate.get(date)! }));
	}

	private exportCsvs(): { files: Array<{ name: string; content: string }> } {
		const kpis = this.getKpis();
		const agents = this.getAgents(undefined, 100);
		const models = this.getModels(undefined, 100);
		const activity = this.getActivity(undefined, 200);

		const csv = (rows: any[][]) => rows.map(r => r.map(v => this.csvCell(v)).join(',')).join('\n');
		const files = [
			{ name: 'kpis.csv', content: csv([['metric','value'], ...Object.entries(kpis)] as any) },
			{ name: 'agents.csv', content: csv([['id','count','latencyMsMedian','editRatio'], ...agents.map(a => [a.id,a.count,a.latencyMsMedian,a.editRatio])]) },
			{ name: 'models.csv', content: csv([['id','count','tokensEst','latencyMsMedian'], ...models.map(m => [m.id,m.count,m.tokensEst || 0,m.latencyMsMedian])]) },
			{ name: 'activity.csv', content: csv([['timeISO','type','agent','model','file','latencyMs','sessionId','requestId'], ...activity.map(a => [a.timeISO,a.type,a.agent,a.model,a.file || '',a.latencyMs || '',a.sessionId,a.requestId])]) },
		];
		return { files };
	}

	// Helpers
	private applyFilterToTurns(requests: Array<ReturnType<AnalyticsService['mapTurn']>>, filter?: AnalyticsFilter): Array<ReturnType<AnalyticsService['mapTurn']>> {
		if (!filter) {
			return requests;
		}
		let reqs = requests;
		// time range
		if (filter.timeRange && filter.timeRange !== 'all') {
			const end = new Date();
			let start = new Date(0);
			if (filter.timeRange === 'today') {
				start = new Date(end.getFullYear(), end.getMonth(), end.getDate());
			} else if (filter.timeRange === '7d') {
				start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
			} else if (filter.timeRange === '30d') {
				start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
			} else if (filter.timeRange === '90d') {
				start = new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);
			}
			reqs = reqs.filter(r => {
				const t = new Date(r.timeISO).getTime();
				return t >= start.getTime() && t <= end.getTime();
			});
		}
		// workspace
		if (filter.workspace === 'current' && filter.workspaceId) {
			reqs = reqs.filter(r => r.workspaceId === filter.workspaceId);
		}
		// agents
		if (filter.agentIds && filter.agentIds.length) {
			const set = new Set(filter.agentIds);
			reqs = reqs.filter(r => r.agent && set.has(r.agent));
		}
		// models
		if (filter.modelIds && filter.modelIds.length) {
			const set = new Set(filter.modelIds);
			reqs = reqs.filter(r => r.model && set.has(r.model));
		}
		return reqs;
	}

	private flattenTurns(): Array<ReturnType<AnalyticsService['mapTurn']>> {
		const out: Array<ReturnType<AnalyticsService['mapTurn']>> = [];
		for (const s of this.rawSessions) {
			const workspaceId = s.harvestedMetadata?.workspaceId;
			const sessionId = s.session.sessionId;
			for (const turn of s.session.turns) {
				out.push(this.mapTurn(turn, sessionId, workspaceId));
			}
		}
		// Keep stable order by time
		out.sort((a, b) => a.timeISO.localeCompare(b.timeISO));
		return out;
	}

	private mapTurn(turn: CopilotChatTurn, sessionId: string, workspaceId?: string) {
		const timestamp = new Date(turn.timestamp);
		const modes = Array.isArray(turn.modes) ? turn.modes : [];
		const type = modes[0] || 'ask';
		const agent = turn.agent?.id || undefined;
		const model = turn.modelId || undefined;
		const latencyMs = turn.result?.timings?.totalElapsed;
		const turnId = turn.responseId || turn.turnId;
		const modelRequests = turn.result?.metadata?.toolCallRounds || [];
		const filePath = this.extractFirstFilePath(turn);
		const language = this.inferLanguage(turn);
		return {
			// Core
			sessionId,
			workspaceId,
			timeISO: timestamp.toISOString(),
			type,
			agent,
			model,
			filePath,
			latencyMs,
			turnId,
			language,
			modelRequests,
		};
	}

	private extractFirstFilePath(req: CopilotChatTurn): string | undefined {
		const refs = req.contentReferences || [];
		for (const r of refs) {
			const ref = (r as any).reference || {};
			const p = ref.fsPath || ref.path || ref.uri || ref.external;
			if (typeof p === 'string' && p.trim().length > 0) {
				return p;
			}
		}
		return undefined;
	}

	private inferLanguage(req: CopilotChatTurn): string | undefined {
		// Try codeBlocks language
		const blocks = (req.result as any)?.metadata?.codeBlocks || (req as any).codeBlocks;
		if (Array.isArray(blocks)) {
			for (const b of blocks) {
				const lang = (b && (b.language || b.lang))?.toString();
				if (lang) { return lang; }
			}
		}
		// Fallback to file extension from first content reference
		const fp = this.extractFirstFilePath(req);
		if (fp) {
			const m = fp.match(/\.([a-zA-Z0-9]+)$/);
			if (m) { return m[1].toLowerCase(); }
		}
		return undefined;
	}

	private median(values: number[]): number | undefined {
		if (!values.length) {
			return undefined;
		}
		const arr = values.slice().sort((a, b) => a - b);
		const mid = Math.floor(arr.length / 2);
		return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
	}

	private enumerateDays(start: Date, end: Date): string[] {
		const days: string[] = [];
		const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
		const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
		while (cur <= last) {
			days.push(cur.toISOString().split('T')[0]);
			cur.setDate(cur.getDate() + 1);
		}
		return days;
	}

	private csvCell(v: any): string {
		if (v === null || v === undefined) {
			return '';
		}
		const s = String(v);
		if (/[",\n]/.test(s)) {
			return '"' + s.replace(/"/g, '""') + '"';
		}
		return s;
	}

	isScanning(): boolean {
		return this.unified.isScanning;
	}

	// Wire-up helpers
	private async initializeRawSessionSource(): Promise<void> {
		try {
			// Seed cache
			this.rawSessions = await this.unified.getRawSessionResults();
			this.logger.debug(`Seeded ${this.rawSessions.length} raw sessions`);
			// Let listeners know initial analytics are ready
			this.emitAnalyticsUpdated();
			// Subscribe to incremental raw session updates
			this.unified.onRawSessionResultsUpdated((results: SessionScanResult[]) => {
				try {
					this.mergeRawSessions(results);
					this.logger.trace(`Merged ${results.length} raw session updates (total: ${this.rawSessions.length})`);
					this.emitAnalyticsUpdated();
				} catch (e) {
					this.logger.error(`Raw session update failed: ${e}`);
				}
			});
		} catch (e) {
			this.logger.debug(`initializeRawSessionSource error: ${e}`);
		}
	}

	private mergeRawSessions(updates: SessionScanResult[]): void {
		const byId = new Map(this.rawSessions.map(r => [r.session.sessionId, r] as const));
		for (const u of updates) {
			byId.set(u.session.sessionId, u);
		}
		this.rawSessions = Array.from(byId.values());
		// Keep deterministic order by creation date
		this.rawSessions.sort((a, b) => new Date(a.session.creationDate).getTime() - new Date(b.session.creationDate).getTime());
	}

	private async refreshFromUnifiedService(full: boolean): Promise<void> {
		try {
			const results = await this.unified.getRawSessionResults();
			if (full) {
				this.rawSessions = results.slice();
				this.rawSessions.sort((a, b) => new Date(a.session.creationDate).getTime() - new Date(b.session.creationDate).getTime());
				this.logger.debug(`Refreshed raw sessions (replace): ${this.rawSessions.length}`);
			} else {
				this.mergeRawSessions(results);
				this.logger.debug(`Refreshed raw sessions (merge): ${this.rawSessions.length}`);
			}
			this.emitAnalyticsUpdated();
		} catch (e) {
			this.logger.debug(`refreshFromUnifiedService error: ${e}`);
		}
	}
}
