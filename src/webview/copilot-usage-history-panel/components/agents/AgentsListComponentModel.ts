import { AnalyticsService, AgentStat } from '../../../../services/analytics-service';
import { ILogger } from '../../../../types/logger';
import { IComponentModel } from '../shared/IComponentModel';
import type { GlobalFilters } from '../../copilot-usage-history-model';

export interface AgentsListVMState {
	items: AgentStat[];
	isLoading: boolean;
	lastUpdated?: Date;
}

/**
 * Agents List Component Model implementing the new IComponentModel framework
 */
export class AgentsListComponentModel implements IComponentModel {
	public readonly id = 'agents';
	private state: AgentsListVMState = { items: [], isLoading: true };

	constructor(
		private readonly analyticsService: AnalyticsService,
		private readonly logger: ILogger
	) {}

	/**
	 * Refresh data based on current filters (implements IComponentModel)
	 */
	async refresh(filters: GlobalFilters): Promise<void> {
		try {
			this.setLoading(true);
			
			// Map 'all' to '90d' temporarily for analytics until backend supports 'all'
			const effectiveTimeRange = (filters.timeRange === 'all' ? '90d' : filters.timeRange) as Exclude<import('../../../../services/analytics-service').TimeRange, 'all'>;
			const filter = { timeRange: effectiveTimeRange } as const;
			
			// Get agents data from analytics service (limit to 25 items)
			const agents = this.analyticsService.getAgents(filter, 25);
			
			this.patch({ 
				items: agents, 
				isLoading: false, 
				lastUpdated: new Date()
			});
			
		} catch (error) {
			this.logger.error('AgentsListComponentModel.refresh failed:', error);
			this.patch({ isLoading: false });
		}
	}

	/**
	 * Check if loading (implements IComponentModel)
	 */
	isLoading(): boolean {
		return this.state.isLoading;
	}

	/**
	 * Dispose resources (implements IComponentModel)
	 */
	dispose(): void {
		// No resources to dispose
	}

	// Legacy API methods for backward compatibility with existing views
	getState(): AgentsListVMState { 
		return this.state; 
	}

	setLoading(flag: boolean): void { 
		this.patch({ isLoading: flag }); 
	}

	/**
	 * Load agents data for the specified time range (legacy method)
	 */
	loadAgents(timeRange: import('../../../../services/analytics-service').TimeRange): void {
		try {
			this.setLoading(true);
			const filter = { timeRange } as const;
			const agents = this.analyticsService.getAgents(filter, 25);
			this.patch({ 
				items: agents, 
				isLoading: false, 
				lastUpdated: new Date()
			});
		} catch (e) {
			this.logger.error('AgentsListComponentModel.loadAgents failed', e);
			this.patch({ isLoading: false });
		}
	}

	/**
	 * Apply agents data directly (called from model updates) (legacy method)
	 */
	applyAgents(agents: AgentStat[]): void {
		this.patch({ 
			items: agents, 
			isLoading: false, 
			lastUpdated: new Date()
		});
	}

	private patch(p: Partial<AgentsListVMState>): void {
		this.state = { ...this.state, ...p };
	}
}