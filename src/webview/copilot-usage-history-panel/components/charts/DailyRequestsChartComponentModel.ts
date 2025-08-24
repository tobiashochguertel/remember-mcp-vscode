import { AnalyticsService } from '../../../../services/analytics-service';
import { ILogger } from '../../../../types/logger';
import { IComponentModel } from '../shared/IComponentModel';
import type { GlobalFilters } from '../../copilot-usage-history-model';

export interface DailyRequestsChartVMState {
	data: Array<{ date: string; requests: number }>;
	isLoading: boolean;
	lastUpdated?: Date;
	isEmpty: boolean;
}

/**
 * Daily Requests Chart Component Model implementing the new IComponentModel framework
 */
export class DailyRequestsChartComponentModel implements IComponentModel {
	public readonly id = 'charts';
	private state: DailyRequestsChartVMState = { 
		data: [], 
		isLoading: true, 
		isEmpty: true 
	};

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
			
			// Get daily requests data from analytics service
			const data = this.analyticsService.getDailyRequests(filter);
			const isEmpty = data.every(item => item.requests === 0);
			
			this.patch({ 
				data, 
				isLoading: false, 
				lastUpdated: new Date(),
				isEmpty
			});
			
		} catch (error) {
			this.logger.error('DailyRequestsChartComponentModel.refresh failed:', error);
			this.patch({ isLoading: false, isEmpty: true });
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
	getState(): DailyRequestsChartVMState { 
		return this.state; 
	}

	setLoading(flag: boolean): void { 
		this.patch({ isLoading: flag }); 
	}

	/**
	 * Load daily requests data for the specified time range (legacy method)
	 */
	loadDailyRequests(timeRange: import('../../../../services/analytics-service').TimeRange): void {
		try {
			this.setLoading(true);
			const filter = { timeRange } as const;
			const data = this.analyticsService.getDailyRequests(filter);
			const isEmpty = data.every(item => item.requests === 0);
			
			this.patch({ 
				data, 
				isLoading: false, 
				lastUpdated: new Date(),
				isEmpty
			});
		} catch (e) {
			this.logger.error('DailyRequestsChartComponentModel.loadDailyRequests failed', e);
			this.patch({ isLoading: false, isEmpty: true });
		}
	}

	/**
	 * Apply daily requests data directly (called from model updates) (legacy method)
	 */
	applyDailyRequests(data: Array<{ date: string; requests: number }>): void {
		const isEmpty = data.every(item => item.requests === 0);
		this.patch({ 
			data, 
			isLoading: false, 
			lastUpdated: new Date(),
			isEmpty
		});
	}

	/**
	 * Get Chart.js compatible data structure
	 */
	getChartData(): { labels: string[]; data: number[] } {
		const { data } = this.state;
		
		// Format dates for display (e.g., "Dec 15" instead of "2024-12-15")
		const labels = data.map(item => {
			const date = new Date(item.date);
			return date.toLocaleDateString('en-US', { 
				month: 'short', 
				day: 'numeric' 
			});
		});
		
		const chartData = data.map(item => item.requests);
		
		return { labels, data: chartData };
	}

	private patch(p: Partial<DailyRequestsChartVMState>): void {
		this.state = { ...this.state, ...p };
	}
}