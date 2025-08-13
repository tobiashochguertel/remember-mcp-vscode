import { CopilotUsageEvent } from '../types/usage-events';
import { ILogger } from '../types/logger';

export type TimeRange = 'today' | '7d' | '30d' | '90d' | 'all';

export interface AnalyticsFilter {
	timeRange?: TimeRange;
	workspace?: 'current' | 'all';
	workspaceId?: string;
	agentIds?: string[];
	modelIds?: string[];
}

export interface Kpis {
	requests: number;
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

export interface TimeSeriesPoint {
	t: string; // day key YYYY-MM-DD
	total: number;
	byType?: Record<string, number>;
}

export class AnalyticsService {
	private events: CopilotUsageEvent[] = [];
	private logger: ILogger;

	constructor(logger: ILogger) {
		this.logger = logger;
	}

	ingest(events: CopilotUsageEvent[], opts?: { replace?: boolean }): void {
		if (opts?.replace) {
			this.events = events.slice();
		} else {
			// dedupe by id (and requestId within session as fallback)
			const existing = new Set(this.events.map(e => e.id));
			for (const ev of events) {
				if (!existing.has(ev.id)) {
					this.events.push(ev);
				}
			}
			// keep stable order by timestamp
			this.events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
		}
		this.logger.debug(`[AnalyticsService] Ingested ${events.length} events (total: ${this.events.length})`);
	}

	getKpis(filter?: AnalyticsFilter): Kpis {
		const evs = this.applyFilter(this.events, filter);
		const sessions = new Set(evs.map(e => e.sessionId)).size;
		const files = new Set(evs.map(e => e.filePath).filter(Boolean)).size;
		const models = new Set(evs.map(e => e.model).filter(Boolean)).size;
		const agents = new Set(evs.map(e => e.agent).filter(Boolean)).size;
		const latencies = evs.map(e => e.duration).filter((v): v is number => typeof v === 'number' && !isNaN(v));
		const latencyMsMedian = this.median(latencies) ?? 0;

		// edits approximation: count events typed as edit
		const edits = evs.filter(e => e.type === 'edit').length;
		const requests = evs.length;
		const editRatio = requests > 0 ? edits / requests : 0;

		return { requests, sessions, files, edits, latencyMsMedian, editRatio, models, agents };
	}

	getAgents(filter?: AnalyticsFilter, limit = 5): AgentStat[] {
		const evs = this.applyFilter(this.events, filter);
		const byAgent = new Map<string, CopilotUsageEvent[]>();
		for (const e of evs) {
			const key = e.agent || 'unknown';
			const arr = byAgent.get(key) || [];
			arr.push(e);
			byAgent.set(key, arr);
		}
		const end = new Date();
		const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000);
		const days = this.enumerateDays(start, end);

		const stats: AgentStat[] = Array.from(byAgent.entries())
			.map(([id, arr]) => {
				const latencies = arr.map(e => e.duration).filter((v): v is number => typeof v === 'number' && !isNaN(v));
				const latencyMsMedian = this.median(latencies) ?? 0;
				const edits = arr.filter(e => e.type === 'edit').length;
				const editRatio = arr.length > 0 ? edits / arr.length : 0;
				const series7d = days.map(d => arr.filter(e => e.timestamp.startsWith(d)).length);
				return { id, count: arr.length, latencyMsMedian, editRatio, series7d };
			})
			.sort((a, b) => b.count - a.count);

		return stats.slice(0, limit);
	}

	getModels(filter?: AnalyticsFilter, limit = 5): ModelStat[] {
		const evs = this.applyFilter(this.events, filter);
		const byModel = new Map<string, CopilotUsageEvent[]>();
		for (const e of evs) {
			const key = e.model || 'unknown';
			const arr = byModel.get(key) || [];
			arr.push(e);
			byModel.set(key, arr);
		}
		const stats: ModelStat[] = Array.from(byModel.entries())
			.map(([id, arr]) => {
				const latencies = arr.map(e => e.duration).filter((v): v is number => typeof v === 'number' && !isNaN(v));
				const latencyMsMedian = this.median(latencies) ?? 0;
				const tokensEst = arr.reduce((s, e) => s + (e.tokensUsed || 0), 0);
				return { id, count: arr.length, tokensEst, latencyMsMedian };
			})
			.sort((a, b) => b.count - a.count);
		return stats.slice(0, limit);
	}

	getLanguages(filter?: AnalyticsFilter, limit = 10): LanguageStat[] {
		const evs = this.applyFilter(this.events, filter);
		const byLang = new Map<string, number>();
		for (const e of evs) {
			const key = (e.language && e.language.trim()) || 'unknown';
			byLang.set(key, (byLang.get(key) || 0) + 1);
		}
		const stats: LanguageStat[] = Array.from(byLang.entries())
			.map(([id, count]) => ({ id, count }))
			.sort((a, b) => b.count - a.count);
		return stats.slice(0, limit);
	}

	getActivity(filter?: AnalyticsFilter, limit = 20): ActivityItem[] {
		const evs = this.applyFilter(this.events, filter);
		const items: ActivityItem[] = evs
			.slice(-limit)
			.reverse()
			.map(e => ({
				timeISO: e.timestamp,
				type: e.type,
				agent: e.agent || 'unknown',
				model: e.model || 'unknown',
				file: e.filePath,
				latencyMs: e.duration,
				sessionId: e.sessionId,
				requestId: e.requestId || e.id
			}));
		return items;
	}

	getTimeSeries(filter?: AnalyticsFilter): TimeSeriesPoint[] {
		const evs = this.applyFilter(this.events, filter);
		const byDay = new Map<string, { total: number; byType: Record<string, number> }>();
		for (const e of evs) {
			const key = e.timestamp.split('T')[0];
			if (!byDay.has(key)) {
				byDay.set(key, { total: 0, byType: {} });
			}
			const row = byDay.get(key)!;
			row.total += 1;
			row.byType[e.type] = (row.byType[e.type] || 0) + 1;
		}
		return Array.from(byDay.entries())
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([t, v]) => ({ t, total: v.total, byType: v.byType }));
	}

	exportCsvs(): { files: Array<{ name: string; content: string }> } {
		const kpis = this.getKpis();
		const agents = this.getAgents(undefined, 100);
		const models = this.getModels(undefined, 100);
		const activity = this.getActivity(undefined, 200);
		const ts = this.getTimeSeries();

		const csv = (rows: any[][]) => rows.map(r => r.map(v => this.csvCell(v)).join(',')).join('\n');
		const files = [
			{ name: 'kpis.csv', content: csv([['metric','value'], ...Object.entries(kpis)] as any) },
			{ name: 'agents.csv', content: csv([['id','count','latencyMsMedian','editRatio'], ...agents.map(a => [a.id,a.count,a.latencyMsMedian,a.editRatio])]) },
			{ name: 'models.csv', content: csv([['id','count','tokensEst','latencyMsMedian'], ...models.map(m => [m.id,m.count,m.tokensEst || 0,m.latencyMsMedian])]) },
			{ name: 'activity.csv', content: csv([['timeISO','type','agent','model','file','latencyMs','sessionId','requestId'], ...activity.map(a => [a.timeISO,a.type,a.agent,a.model,a.file || '',a.latencyMs || '',a.sessionId,a.requestId])]) },
			{ name: 'timeseries.csv', content: csv([['t','total','byType'], ...ts.map(p => [p.t,p.total,JSON.stringify(p.byType || {})])]) },
		];
		return { files };
	}

	// Helpers
	private applyFilter(events: CopilotUsageEvent[], filter?: AnalyticsFilter): CopilotUsageEvent[] {
		if (!filter) {
			return events;
		}
		let evs = events;
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
			evs = evs.filter(e => {
				const t = new Date(e.timestamp).getTime();
				return t >= start.getTime() && t <= end.getTime();
			});
		}
		// workspace
		if (filter.workspace === 'current' && filter.workspaceId) {
			evs = evs.filter(e => e.workspaceId === filter.workspaceId);
		}
		// agents
		if (filter.agentIds && filter.agentIds.length) {
			const set = new Set(filter.agentIds);
			evs = evs.filter(e => e.agent && set.has(e.agent));
		}
		// models
		if (filter.modelIds && filter.modelIds.length) {
			const set = new Set(filter.modelIds);
			evs = evs.filter(e => e.model && set.has(e.model));
		}
		return evs;
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
}
