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
	private _listeners: Array<() => void> = [];
	private _errorMessage: string | undefined;

	// Global filter state (authoritative in-memory runtime filters)
	private _filters = new GlobalFilters();
	private _filterListeners: Array<(f: GlobalFilters) => void> = [];

	/**
	 * Get current global filters (immutable copy)
	 */
	public getFilters(): GlobalFilters {
		const copy = new GlobalFilters();
		copy.timeRange = this._filters.timeRange;
		copy.workspace = this._filters.workspace;
		copy.agents = [...this._filters.agents];
		copy.models = [...this._filters.models];
		return copy;
	}

	/**
	 * Subscribe to global filter changes
	 */
	public onFiltersChanged(listener: (f: GlobalFilters) => void): void {
		this._filterListeners.push(listener);
	}

	private _emitFilters(): void {
		for (const l of this._filterListeners) {
			try { l(this.getFilters()); } catch (e) { this.logger.error('Filter listener error', e); }
		}
	}

	/**
	 * Update filters (authoritative runtime state). Handles mapping of 'all' timeRange internally
	 */
	public async updateFilters(patch: Partial<GlobalFilters>): Promise<void> {
		const prev = JSON.stringify(this._filters);
		Object.assign(this._filters, patch);
		const changed = prev !== JSON.stringify(this._filters);
		if (!changed) { return; }
		
		this.logger.debug?.('[Filters] updateFilters', { filters: this._filters });
		this._emitFilters();
		
		// For now only timeRange drives data reloads
		if (patch.timeRange) {
			// Map 'all' to '90d' temporarily for analytics/settings until backend full support
			const effective: Exclude<AnalyticsTimeRange,'all'> = (this._filters.timeRange === 'all' ? '90d' : this._filters.timeRange) as Exclude<AnalyticsTimeRange,'all'>;
			// Persist only supported enumerated range (no 'all')
			await this.updateSettings({ defaultTimeRange: effective });
			await this.refreshAllData();
		} else {
			// Future: targeted refreshes for agents/models; for now do full refresh to stay correct
			await this.refreshAllData();
		}
	}

	// Component models (injected by panel)
	private _componentModels: IComponentModel[] = [];

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

	// Backward compatibility properties for views
	public get filtersViewModel(): any {
		// Direct access for converted models
		return this.getComponentModel('filters');
	}

	public get kpiChipsViewModel(): any {
		// Direct access for converted models
		return this.getComponentModel('kpis');
	}

	public get agentsListViewModel(): any {
		const adapter = this.getComponentModel('agents') as any;
		return adapter?.legacyModel;
	}

	public get modelsListViewModel(): any {
		const adapter = this.getComponentModel('models') as any;
		return adapter?.legacyModel;
	}

	public get activityFeedViewModel(): any {
		const adapter = this.getComponentModel('activity') as any;
		return adapter?.legacyModel;
	}

	public get dailyRequestsChartViewModel(): any {
		// Return the new component model directly (it has backward compatible methods)
		return this.getComponentModel('charts');
	}

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


	/**
	 * Public API methods
	 */

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
		await this.updateSettings({ defaultTimeRange: timeRange });
		await this.refreshAllData();
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
		this._filterListeners = [];
		// No explicit unsubscribe available for analytics; instance lifespan is tied to panel lifespan
	}

	public isScanning(): boolean {
		return this.analyticsService.isScanning();
	}

	// ---------- New helpers using AnalyticsService / Unified data ----------
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

}

// Global filters class (runtime authoritative state)
export class GlobalFilters {
	public timeRange: 'today' | '7d' | '30d' | '90d' | 'all' = '30d';
	public workspace: string = 'all'; // 'all' or specific workspace identifier
	public agents: string[] = []; // empty => all
	public models: string[] = []; // empty => all
}
