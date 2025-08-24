import * as vscode from 'vscode';
import { UnifiedSessionDataService } from '../../services/unified-session-data-service';
import { AnalyticsService, TimeRange as AnalyticsTimeRange } from '../../services/analytics-service';
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
		private readonly unifiedService: UnifiedSessionDataService,
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
		
		// Persist timeRange setting if it changed
		await this.updateSettings({ defaultTimeRange: filters.timeRange === 'all' ? '90d' : filters.timeRange });
		
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
		const gf = this.getFilters();
		const effective = (gf.timeRange === 'all' ? '90d' : gf.timeRange) as AnalyticsTimeRange;
		const filter = { timeRange: effective } as const;
		const kpis = this.analyticsService.getKpis(filter);
		return (kpis.turns || 0) > 0;
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

	// Settings Persistence
	private async getSettings(): Promise<{ defaultTimeRange: 'today' | '7d' | '30d' | '90d' }> { // TODO(persistence-v1): Extend to full GlobalFilters snapshot with versioning
		const key = 'copilot-usage-history-settings';
		const stored = this.extensionContext.globalState.get<{ defaultTimeRange: 'today' | '7d' | '30d' | '90d' }>(key);
		return stored || { defaultTimeRange: '30d' };
	}

	private async updateSettings(update: Partial<{ defaultTimeRange: 'today' | '7d' | '30d' | '90d' }>): Promise<void> { // TODO(persistence-v1): Replace with unified saveFilters() (debounced) once full filter persistence added
		const key = 'copilot-usage-history-settings';
		const current = await this.getSettings();
		await this.extensionContext.globalState.update(key, { ...current, ...update });
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

// Global filters class (runtime authoritative state)
export class GlobalFilters {
	public timeRange: 'today' | '7d' | '30d' | '90d' | 'all' = '30d';
	public workspace: string = 'all'; // 'all' or specific workspace identifier
	public agents: string[] = []; // empty => all
	public models: string[] = []; // empty => all
}
