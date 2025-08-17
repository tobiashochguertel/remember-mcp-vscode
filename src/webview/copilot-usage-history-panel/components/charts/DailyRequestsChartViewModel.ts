import { AnalyticsService, TimeRange } from '../../../../services/analytics-service';
import { ILogger } from '../../../../types/logger';
import { CopilotUsageHistoryModel } from '../../copilot-usage-history-model';

export interface DailyRequestsChartVMState {
	data: Array<{ date: string; requests: number }>;
	isLoading: boolean;
	lastUpdated?: Date;
	isEmpty: boolean;
}

/**
 * View model for daily requests chart component
 * Manages the data transformation for Chart.js bar chart
 */
export class DailyRequestsChartViewModel {
	private state: DailyRequestsChartVMState = { 
		data: [], 
		isLoading: true, 
		isEmpty: true 
	};
	private listeners: Array<() => void> = [];

	constructor(
		private model: CopilotUsageHistoryModel, 
		private analytics: AnalyticsService, 
		private logger: ILogger
	) {}

	getState(): DailyRequestsChartVMState { 
		return this.state; 
	}

	onDidChange(listener: () => void): void { 
		this.listeners.push(listener); 
	}

	setLoading(flag: boolean): void { 
		this.patch({ isLoading: flag }); 
	}

	/**
	 * Load daily requests data for the specified time range
	 */
	loadDailyRequests(timeRange: TimeRange): void {
		try {
			this.setLoading(true);
			const filter = { timeRange } as const;
			const data = this.analytics.getDailyRequests(filter);
			const isEmpty = data.every(item => item.requests === 0);
			
			this.patch({ 
				data, 
				isLoading: false, 
				lastUpdated: new Date(),
				isEmpty
			});
		} catch (e) {
			this.logger.error('DailyRequestsChartViewModel.loadDailyRequests failed', e);
			this.patch({ isLoading: false, isEmpty: true });
		}
	}

	/**
	 * Apply daily requests data directly (called from model updates)
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
		for (const l of this.listeners) {
			try { 
				l(); 
			} catch (e) { 
				this.logger.error('DailyRequestsChartViewModel listener error', e); 
			}
		}
	}
}
