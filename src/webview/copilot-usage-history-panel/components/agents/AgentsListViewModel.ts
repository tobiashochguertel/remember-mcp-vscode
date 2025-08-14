import { AnalyticsService, AgentStat, TimeRange } from '../../../../services/analytics-service';
import { ILogger } from '../../../../types/logger';
import { CopilotUsageHistoryModel } from '../../copilot-usage-history-model';

export interface AgentsListVMState {
	items: AgentStat[];
	isLoading: boolean;
	lastUpdated?: Date;
}

/**
 * Minimal Agents list view model – mirrors KPI approach (simple state container)
 */
export class AgentsListViewModel {
	private state: AgentsListVMState = { items: [], isLoading: true };
	private listeners: Array<() => void> = [];

	constructor(private model: CopilotUsageHistoryModel, private analytics: AnalyticsService, private logger: ILogger) {}

	getState(): AgentsListVMState { return this.state; }
	onDidChange(listener: () => void): void { this.listeners.push(listener); }
	setLoading(flag: boolean): void { this.patch({ isLoading: flag }); }

	loadAgents(timeRange: TimeRange): void {
		try {
			this.setLoading(true);
			const filter = { timeRange } as const;
			const agents = this.analytics.getAgents(filter, 25);
			this.patch({ items: agents, isLoading: false, lastUpdated: new Date() });
		} catch (e) {
			this.logger.error('AgentsListViewModel.loadAgents failed', e);
			this.patch({ isLoading: false });
		}
	}

	applyAgents(agents: AgentStat[]): void {
		this.patch({ items: agents, isLoading: false, lastUpdated: new Date() });
	}

	private patch(p: Partial<AgentsListVMState>): void {
		this.state = { ...this.state, ...p };
		for (const l of this.listeners) {
			try { l(); } catch (e) { this.logger.error('AgentsListViewModel listener error', e); }
		}
	}
}
