import { ILogger } from '../types/logger';
import { SessionScanResult, CopilotChatRequest } from '../types/chat-session';
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

	constructor(logger: ILogger, unified: UnifiedSessionDataService) {
		this.logger = logger;
		this.unified = unified;
		// Hook into raw session data stream
		this.initializeRawSessionSource().catch(err => {
			this.logger.error(`Raw session init skipped: ${err}`);
		});
	}

	getKpis(filter?: AnalyticsFilter): Kpis {
		const reqs = this.applyFilterToRequests(this.flattenRequests(), filter);
		const sessions = new Set(reqs.map(r => r.sessionId)).size;
		const files = new Set(reqs.map(r => r.filePath).filter(Boolean)).size;
		const models = new Set(reqs.map(r => r.model).filter(Boolean)).size;
		const agents = new Set(reqs.map(r => r.agent).filter(Boolean)).size;
		const latencies = reqs.map(r => r.latencyMs).filter((v): v is number => typeof v === 'number' && !isNaN(v));
		const latencyMsMedian = this.median(latencies) ?? 0;

		// edits approximation: count requests with mode 'edit'
		const edits = reqs.filter(r => r.type === 'edit').length;
		const requests = reqs.length;
		const editRatio = requests > 0 ? edits / requests : 0;

		return { turns: requests, sessions, files, edits, latencyMsMedian, editRatio, models, agents };
	}

	getAgents(filter?: AnalyticsFilter, limit = 5): AgentStat[] {
		const reqs = this.applyFilterToRequests(this.flattenRequests(), filter);
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
		const reqs = this.applyFilterToRequests(this.flattenRequests(), filter);
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
		const reqs = this.applyFilterToRequests(this.flattenRequests(), filter);
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
		const reqs = this.applyFilterToRequests(this.flattenRequests(), filter);
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
				requestId: r.requestId
			}));
		return items;
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
	private applyFilterToRequests(requests: Array<ReturnType<AnalyticsService['mapRequest']>>, filter?: AnalyticsFilter): Array<ReturnType<AnalyticsService['mapRequest']>> {
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

	private flattenRequests(): Array<ReturnType<AnalyticsService['mapRequest']>> {
		const out: Array<ReturnType<AnalyticsService['mapRequest']>> = [];
		for (const s of this.rawSessions) {
			const workspaceId = s.harvestedMetadata?.workspaceId;
			const sessionId = s.session.sessionId;
			for (const req of s.session.requests) {
				out.push(this.mapRequest(req, sessionId, workspaceId));
			}
		}
		// Keep stable order by time
		out.sort((a, b) => a.timeISO.localeCompare(b.timeISO));
		return out;
	}

	private mapRequest(req: CopilotChatRequest, sessionId: string, workspaceId?: string) {
		const timestamp = new Date(req.timestamp);
		const modes = Array.isArray(req.modes) ? req.modes : [];
		const type = modes[0] || 'ask';
		const agent = req.agent?.id || undefined;
		const model = req.modelId || undefined;
		const latencyMs = req.result?.timings?.totalElapsed;
		const requestId = req.responseId || req.turnId;
		const filePath = this.extractFirstFilePath(req);
		const language = this.inferLanguage(req);
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
			requestId,
			language,
		};
	}

	private extractFirstFilePath(req: CopilotChatRequest): string | undefined {
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

	private inferLanguage(req: CopilotChatRequest): string | undefined {
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

	// Wire-up helpers
	private async initializeRawSessionSource(): Promise<void> {
		try {
			// Seed cache
			this.rawSessions = await this.unified.getRawSessionResults();
			this.logger.debug(`Seeded ${this.rawSessions.length} raw sessions`);
			// Subscribe to incremental raw session updates
			this.unified.onRawSessionResultsUpdated((results: SessionScanResult[]) => {
				try {
					this.mergeRawSessions(results);
					this.logger.trace(`Merged ${results.length} raw session updates (total: ${this.rawSessions.length})`);
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
		} catch (e) {
			this.logger.debug(`refreshFromUnifiedService error: ${e}`);
		}
	}
}
