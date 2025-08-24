import * as vscode from 'vscode';
import { AnalyticsService, AnalyticsFilter, TimeRange } from '../../services/analytics-service';
import { IComponentModel } from './components/shared/IComponentModel';
import { ILogger } from '../../types/logger';

/**
 * Model for Copilot Usage History Panel
 * Composes micro-view-models and manages data/business logic
 */
export class CopilotUsageHistoryModel {
	// Private state
	private _listeners: Array<() => void> = [];
	private _errorMessage: string | undefined;
	private _componentModels: IComponentModel[] = [];

	// Global filter state (authoritative in-memory runtime filters)
	private _filters = new GlobalFilters();

	// Constructor
	constructor(
		private readonly extensionContext: vscode.ExtensionContext,
		private readonly analyticsService: AnalyticsService,
		private readonly logger: ILogger
	)	{
		// Start background data initialization (non-blocking)
		this.initializeDataAsync();

		// Subscribe to analytics updates so the panel can refresh when analytics change
		this.analyticsService.onAnalyticsUpdated(() => {
			this.logger.trace?.('HistoryModel: analytics updated -> refreshing view models');
			this.refreshAllData().catch(err => this.logger.error('HistoryModel: refresh after analytics update failed', err));
		});
	}

	// Component Model Management
	/**
	 * Set component models (called by panel after construction)
	 */
	public setComponentModels(componentModels: IComponentModel[]): void {
		this._componentModels = componentModels;
		this.logger.trace(`Set ${componentModels.length} component models:`, componentModels.map(m => m.id));
	}

	/**
	 * Get component model by ID (for backward compatibility with views)
	 */
	public getComponentModel<T extends IComponentModel>(id: string): T | undefined {
		return this._componentModels.find(m => m.id === id) as T;
	}

	// Global Filter Management
	/**
	 * Get global filters (direct access to the instance)
	 */
	public getFilters(): GlobalFilters {
		return this._filters;
	}

	/**
	 * Update filters and refresh data accordingly
	 */
	public async updateFilters(filters: GlobalFilters): Promise<void> {
		this.logger.debug?.('[Filters] updateFilters', { filters });
		
		// Update the internal state
		this._filters = filters;
		
		// Persist the entire filter state
		await this.saveFilters(filters);
		
		// Refresh all data
		await this.refreshAllData();
	}

	// Data Initialization and Refresh
	/**
	 * Initialize data asynchronously in the background
	 */
	private initializeDataAsync(): void {
		// Fire and forget - don't await
		this.initializeData().catch(error => {
			this.logger.error('Background data initialization failed:', error);
			this.setGlobalError(String(error));
		});
	}

	/**
	 * Load initial data and update all micro-view-models
	 */
	private async initializeData(): Promise<void> {
		try {
			// Load persisted filters first
			await this.loadPersistedFilters();
			
			// Load initial data
			await this.refreshAllData();
		} catch (error) {
			this.logger.error('Failed to initialize history model:', error);
			this.setGlobalError(String(error));
		}
	}

	/**
	 * Refresh all data and update component models
	 */
	public async refreshAllData(): Promise<void> {
		try {
			// Refresh all component models with current filters
			await this.refreshAllComponents();

			// Notify listeners after component updates
			this.notifyListeners();

		} catch (error) {
			this.logger.error('Failed to refresh data:', error);
			this.setGlobalError(String(error));
		}
	}

	/**
	 * Refresh all component models with current filters
	 */
	private async refreshAllComponents(): Promise<void> {
		const filters = this.getFilters();
		this.logger.info('refreshAllComponents: updating all components with filters:', filters);

		// Refresh all components in parallel
		await Promise.all(
			this._componentModels.map(async (model) => {
				try {
					await model.refresh(filters);
				} catch (error) {
					this.logger.error(`Failed to refresh component model ${model.id}:`, error);
				}
			})
		);
	}

	// Public API Methods
	/**
	 * Subscribe to data changes
	 */
	public onDataChanged(listener: () => void): void {
		this._listeners.push(listener);
	}

	/**
	 * Check if there is any usage data available (driven by AnalyticsService)
	 */
	public hasData(): boolean {
		return this.analyticsService.hasData();
	}

	/**
	 * Update time range setting
	 */
	public async updateTimeRange(timeRange: 'today' | '7d' | '30d' | '90d'): Promise<void> {
		const filters = this.getFilters();
		filters.timeRange = timeRange;
		await this.updateFilters(filters);
	}

	/**
	 * Export usage data
	 */
	public async getExportData(): Promise<any> {
		// Export functionality will be implemented later
		return {
			metadata: {
				exportedAt: new Date().toISOString(),
				status: 'not-implemented'
			},
			data: {}
		};
	}

	public isScanning(): boolean {
		return this.analyticsService.isScanning();
	}

	// Error Handling
	/**
	 * Set global error state
	 */
	private setGlobalError(error: string): void {
		this._errorMessage = error;
		this.logger.error('History model error state:', error);
		this.notifyListeners();
	}

	public getErrorMessage(): string | undefined {
		return this._errorMessage;
	}

	// Event Handling
	/**
	 * Notify all listeners of data changes
	 */
	private notifyListeners(): void {
		this._listeners.forEach(listener => {
			try {
				listener();
			} catch (error) {
				this.logger.error('Error notifying listener:', error);
			}
		});
	}

	// Filter Persistence
	/**
	 * Load persisted filters from storage
	 */
	private async loadFilters(): Promise<GlobalFilters> {
		const key = 'copilot-usage-history-filters';
		const stored = this.extensionContext.globalState.get<GlobalFilters>(key);
		return stored || new GlobalFilters();
	}

	/**
	 * Save current filters to storage
	 */
	private async saveFilters(filters: GlobalFilters): Promise<void> {
		const key = 'copilot-usage-history-filters';
		await this.extensionContext.globalState.update(key, filters);
		this.logger.debug?.('[Persistence] Saved filters:', filters);
	}

	/**
	 * Load persisted filters and apply them to the current filter state
	 */
	private async loadPersistedFilters(): Promise<void> {
		try {
			const persistedFilters = await this.loadFilters();
			this.logger.debug?.('[Persistence] Loading persisted filters:', persistedFilters);
			
			// Apply all persisted filter properties to current filters
			this._filters = persistedFilters;
			
			this.logger.info('[Persistence] Applied persisted filters:', persistedFilters);
		} catch (error) {
			this.logger.error('[Persistence] Failed to load persisted filters:', error);
			// Continue with defaults if loading fails
		}
	}

	// Cleanup
	/**
	 * Dispose and clean up resources
	 */
	public dispose(): void {
		// Dispose all component models
		this._componentModels.forEach(model => {
			try {
				model.dispose();
			} catch (error) {
				this.logger.error(`Error disposing component model ${model.id}:`, error);
			}
		});
		this._componentModels = [];

		// Clear listeners
		this._listeners = [];
		// No explicit unsubscribe available for analytics; instance lifespan is tied to panel lifespan
	}
}

// Global filters class (runtime authoritative state) - compatible with AnalyticsFilter
export class GlobalFilters implements AnalyticsFilter {
	public timeRange?: TimeRange = '30d';
	public workspace?: 'current' | 'all' = 'all';
	public agentIds?: string[] = []; // empty => all
	public modelIds?: string[] = []; // empty => all
}
