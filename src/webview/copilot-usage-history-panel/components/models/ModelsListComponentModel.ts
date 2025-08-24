import { AnalyticsService, ModelStat } from '../../../../services/analytics-service';
import { ILogger } from '../../../../types/logger';
import { IComponentModel } from '../shared/IComponentModel';
import type { GlobalFilters } from '../../copilot-usage-history-model';

export interface ModelsListVMState {
	items: ModelStat[];
	isLoading: boolean;
	lastUpdated?: Date;
}

/**
 * Models List Component Model implementing the new IComponentModel framework
 */
export class ModelsListComponentModel implements IComponentModel {
	public readonly id = 'models';
	private state: ModelsListVMState = { items: [], isLoading: true };
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
			
			// Get models data from analytics service (limit to 50 items)
			const models = this.analyticsService.getModels(filter, 50);
			
			this.patch({ 
				items: models, 
				isLoading: false, 
				lastUpdated: new Date()
			});
			
		} catch (error) {
			this.logger.error('ModelsListComponentModel.refresh failed:', error);
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
	getState(): ModelsListVMState { 
		return this.state; 
	}

	setLoading(flag: boolean): void { 
		this.patch({ isLoading: flag }); 
	}

	/**
	 * Load models data for the specified time range (legacy method)
	 */
	loadModels(timeRange: import('../../../../services/analytics-service').TimeRange): void {
		try {
			this.setLoading(true);
			const filter = { timeRange } as const;
			const models = this.analyticsService.getModels(filter, 50);
			this.patch({ 
				items: models, 
				isLoading: false, 
				lastUpdated: new Date()
			});
		} catch (e) {
			this.logger.error('ModelsListComponentModel.loadModels failed', e);
			this.patch({ isLoading: false });
		}
	}

	/**
	 * Apply models data directly (called from model updates) (legacy method)
	 */
	applyModels(models: ModelStat[]): void {
		this.patch({ 
			items: models, 
			isLoading: false, 
			lastUpdated: new Date()
		});
	}

	private patch(p: Partial<ModelsListVMState>): void {
		this.state = { ...this.state, ...p };
		for (const l of this.listeners) {
			try { 
				l(); 
			} catch (e) { 
				this.logger.error('ModelsListComponentModel listener error', e); 
			}
		}
	}
}