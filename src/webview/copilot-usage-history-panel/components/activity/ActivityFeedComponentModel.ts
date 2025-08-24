import { AnalyticsService, ActivityItem } from '../../../../services/analytics-service';
import { ILogger } from '../../../../types/logger';
import { IComponentModel } from '../shared/IComponentModel';
import type { GlobalFilters } from '../../copilot-usage-history-model';

export interface ActivityFeedVMState {
	items: ActivityItem[];
	isLoading: boolean;
	lastUpdated?: Date;
}

/**
 * Activity Feed Component Model implementing the new IComponentModel framework
 */
export class ActivityFeedComponentModel implements IComponentModel {
	public readonly id = 'activity';
	private state: ActivityFeedVMState = { items: [], isLoading: true };
	private listeners: Array<() => void> = [];

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
			
			// Get activity data from analytics service (limit to 100 items)
			const items = this.analyticsService.getActivity(filter, 100);
			
			this.patch({ 
				items, 
				isLoading: false, 
				lastUpdated: new Date()
			});
			
		} catch (error) {
			this.logger.error('ActivityFeedComponentModel.refresh failed:', error);
			this.patch({ isLoading: false });
		}
	}

	/**
	 * Subscribe to model changes (implements IComponentModel)
	 */
	onDidChange(listener: () => void): () => void {
		this.listeners.push(listener);
		return () => {
			this.listeners = this.listeners.filter(l => l !== listener);
		};
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
		this.listeners = [];
	}

	// Legacy API methods for backward compatibility with existing views
	getState(): ActivityFeedVMState { 
		return this.state; 
	}

	setLoading(flag: boolean): void { 
		this.patch({ isLoading: flag }); 
	}

	/**
	 * Load activity data for the specified time range (legacy method)
	 */
	loadActivity(timeRange: import('../../../../services/analytics-service').TimeRange): void {
		try {
			this.setLoading(true);
			const filter = { timeRange } as const;
			const items = this.analyticsService.getActivity(filter, 100);
			this.patch({ 
				items, 
				isLoading: false, 
				lastUpdated: new Date()
			});
		} catch (e) {
			this.logger.error('ActivityFeedComponentModel.loadActivity failed', e);
			this.patch({ isLoading: false });
		}
	}

	/**
	 * Apply activity data directly (called from model updates) (legacy method)
	 */
	applyActivity(items: ActivityItem[]): void {
		this.patch({ 
			items, 
			isLoading: false, 
			lastUpdated: new Date()
		});
	}

	private patch(p: Partial<ActivityFeedVMState>): void {
		this.state = { ...this.state, ...p };
		for (const l of this.listeners) {
			try { 
				l(); 
			} catch (e) { 
				this.logger.error('ActivityFeedComponentModel listener error', e); 
			}
		}
	}
}