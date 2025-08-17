import * as vscode from 'vscode';
import { UnifiedSessionDataService } from '../../services/unified-session-data-service';
import { AnalyticsService, TimeRange as AnalyticsTimeRange } from '../../services/analytics-service';
import { FiltersViewModel } from './components/filters/FiltersViewModel';
import { KpiChipsViewModel } from './components/kpis/KpiChipsViewModel';
import { AgentsListViewModel } from './components/agents/AgentsListViewModel';
import { ModelsListViewModel } from './components/models/ModelsListViewModel';
import { ActivityFeedViewModel } from './components/activity/ActivityFeedViewModel';
import { DailyRequestsChartViewModel } from './components/charts/DailyRequestsChartViewModel';

import { ILogger } from '../../types/logger';

/**
 * Model for Copilot Usage History Panel
 * Composes micro-view-models and manages data/business logic
 */
export class CopilotUsageHistoryModel {
	private _listeners: Array<() => void> = [];
	private _errorMessage: string | undefined;

	// Global filter state (authoritative in-memory runtime filters)
	private _filters: GlobalFilters = {
		timeRange: '30d',
		workspace: 'all',
		agents: [],
		models: []
	};
	private _filterListeners: Array<(f: GlobalFilters) => void> = [];

	/**
	 * Get current global filters (immutable copy)
	 */
	public getFilters(): GlobalFilters {
		return { ...this._filters, agents: [...this._filters.agents], models: [...this._filters.models] };
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
		const prev = this._filters;
		const next: GlobalFilters = {
			...prev,
			...patch,
			agents: patch.agents ? [...patch.agents] : prev.agents,
			models: patch.models ? [...patch.models] : prev.models
		};
		const changed = JSON.stringify(prev) !== JSON.stringify(next);
		if (!changed) { return; }
		// Compute per-field diff for diagnostic logging (avoid expensive deep diff later)
		const diff: Record<string, { from: any; to: any }> = {};
		for (const k of ['timeRange','workspace']) {
			if ((prev as any)[k] !== (next as any)[k]) { diff[k] = { from: (prev as any)[k], to: (next as any)[k] }; }
		}
		if (prev.agents.join('|') !== next.agents.join('|')) { diff.agents = { from: prev.agents, to: next.agents }; }
		if (prev.models.join('|') !== next.models.join('|')) { diff.models = { from: prev.models, to: next.models }; }
		this.logger.debug?.('[Filters] updateFilters', { diff });
		this._filters = next;
		this._emitFilters();
		// For now only timeRange drives data reloads
		if (patch.timeRange) {
			// Map 'all' to '90d' temporarily for analytics/settings until backend full support
			const effective: Exclude<AnalyticsTimeRange,'all'> = (next.timeRange === 'all' ? '90d' : next.timeRange) as Exclude<AnalyticsTimeRange,'all'>;
			// Persist only supported enumerated range (no 'all')
			await this.updateSettings({ defaultTimeRange: effective });
			await this.refreshAllData();
		} else {
			// Future: targeted refreshes for agents/models; for now do full refresh to stay correct
			await this.refreshAllData();
		}
	}

	// New component view-models (component architecture)
	public filtersViewModel!: FiltersViewModel;
	public kpiChipsViewModel!: KpiChipsViewModel;
	public agentsListViewModel!: AgentsListViewModel;
	public modelsListViewModel!: ModelsListViewModel;
	public activityFeedViewModel!: ActivityFeedViewModel;
	public dailyRequestsChartViewModel!: DailyRequestsChartViewModel;

	constructor(
		private readonly extensionContext: vscode.ExtensionContext,
		private readonly unifiedService: UnifiedSessionDataService,
		private readonly analyticsService: AnalyticsService,
		private readonly logger: ILogger
	)	{
		// Initialize new component-based view models
		this.initializeComponentViewModels();

		// Start background data initialization (non-blocking)
		this.initializeDataAsync();

		// Subscribe to analytics updates so the panel can refresh when analytics change
		this.analyticsService.onAnalyticsUpdated(() => {
			this.logger.trace?.('HistoryModel: analytics updated -> refreshing view models');
			this.refreshAllData().catch(err => this.logger.error('HistoryModel: refresh after analytics update failed', err));
		});
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
	 * Initialize new component-based view-models (component architecture migration)
	 */
	private initializeComponentViewModels(): void {
		try {
			this.filtersViewModel = new FiltersViewModel(this, this.logger);
			this.kpiChipsViewModel = new KpiChipsViewModel(this, this.analyticsService, this.logger);
			this.agentsListViewModel = new AgentsListViewModel(this, this.analyticsService, this.logger);
			this.modelsListViewModel = new ModelsListViewModel(this, this.analyticsService, this.logger);
			this.activityFeedViewModel = new ActivityFeedViewModel(this, this.analyticsService, this.logger);
			this.dailyRequestsChartViewModel = new DailyRequestsChartViewModel(this, this.analyticsService, this.logger);
			this.logger.trace('Initialized component view-models');
		} catch (error) {
			this.logger.error('Failed to initialize component view-models', error);
		}
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
	 * Refresh all data and update micro-view-models
	 */
	public async refreshAllData(): Promise<void> {
		try {

			// Update component view-models from analytics service (no direct events)
			await this.updateComponentViewModels();

			// Notify listeners after component updates
			this.notifyListeners();

		} catch (error) {
			this.logger.error('Failed to refresh data:', error);
			this.setGlobalError(String(error));
		}
	}

	/**
	 * Process session events and update all relevant micro-view-models
	 */
	private async updateComponentViewModels(): Promise<void> {
		this.logger.info('updateComponentViewModels: updating components from AnalyticsService');

		// Get settings directly instead of relying on filter controls that might be stale
		const gf = this.getFilters();
		const effective = (gf.timeRange === 'all' ? '90d' : gf.timeRange) as AnalyticsTimeRange;
		const filter = { timeRange: effective } as const;
		
		const fvTimeRange = this.filtersViewModel?.getState().timeRange;
		this.logger.info(`updateComponentViewModels: FiltersViewModel.timeRange = ${fvTimeRange}`);
		this.logger.info(`updateComponentViewModels: effective.timeRange = ${effective}`);
		this.logger.info(`updateComponentViewModels: filter = ${JSON.stringify(filter)}`);

		// KPIs (simple load)
		const kpis = this.analyticsService.getKpis(filter);
		this.kpiChipsViewModel?.applyKpis(kpis);
		// Agents (simple load)
		const agents = this.analyticsService.getAgents(filter, 25);
		this.agentsListViewModel?.applyAgents(agents);
		// Models (simple load)
		const models = this.analyticsService.getModels(filter, 50);
		this.modelsListViewModel?.applyModels(models);
		// Activity (simple load)
		const activity = this.analyticsService.getActivity(filter, 100);
		this.activityFeedViewModel?.applyActivity(activity);
		// Daily requests chart (simple load)
		const dailyRequests = this.analyticsService.getDailyRequests(filter);
		this.dailyRequestsChartViewModel?.applyDailyRequests(dailyRequests);
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
		// Clear listeners
		this._listeners = [];
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

// Global filters type (runtime authoritative state)
export type GlobalFilters = {
	timeRange: 'today' | '7d' | '30d' | '90d' | 'all';
	workspace: string; // 'all' or specific workspace identifier
	agents: string[]; // empty => all
	models: string[]; // empty => all
};
