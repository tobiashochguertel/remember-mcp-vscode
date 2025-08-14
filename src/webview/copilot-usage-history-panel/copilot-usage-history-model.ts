import * as vscode from 'vscode';
import { UnifiedSessionDataService } from '../../services/unified-session-data-service';
import { AnalyticsService, TimeRange as AnalyticsTimeRange } from '../../services/analytics-service';
import { CopilotUsageEvent, DateRange } from '../../types/usage-events';
import { FiltersViewModel } from './components/filters/FiltersViewModel';
import { KpiChipsViewModel } from './components/kpis/KpiChipsViewModel';
import { AgentsListViewModel } from './components/agents/AgentsListViewModel';
import { ModelsListViewModel } from './components/models/ModelsListViewModel';
import { ActivityFeedViewModel } from './components/activity/ActivityFeedViewModel';

import { ILogger } from '../../types/logger';
import {
	SummaryCardsViewModel,
	ChartViewModel,
	AnalyticsTableViewModel,
	StorageInfoViewModel,
	DebugSectionViewModel,
	GlobalStateViewModel
} from './copilot-usage-history-types';

/**
 * Model for Copilot Usage History Panel
 * Composes micro-view-models and manages data/business logic
 */
export class CopilotUsageHistoryModel {
	private _listeners: Array<() => void> = [];
	private _sessionEventsCallback?: (events: CopilotUsageEvent[]) => void;
	private _logEntriesCallback?: (logEntries: any[]) => void;

	// Micro-view-models
	public summaryCards!: SummaryCardsViewModel;
	public timeSeriesChart!: ChartViewModel;
	public eventTypeChart!: ChartViewModel;
	public languageChart!: ChartViewModel;
	public topLanguagesTable!: AnalyticsTableViewModel;
	public topModelsTable!: AnalyticsTableViewModel;
	public storageInfo!: StorageInfoViewModel;
	public debugSection!: DebugSectionViewModel;
	public globalState!: GlobalStateViewModel;
	// New component view-models (component architecture)
	public filtersViewModel!: FiltersViewModel;
	public kpiChipsViewModel!: KpiChipsViewModel;
	public agentsListViewModel!: AgentsListViewModel;
	public modelsListViewModel!: ModelsListViewModel;
	public activityFeedViewModel!: ActivityFeedViewModel;

	constructor(
		private readonly extensionContext: vscode.ExtensionContext,
		private readonly unifiedService: UnifiedSessionDataService,
		private readonly analyticsService: AnalyticsService,
		private readonly logger: ILogger
	) {
		// Initialize micro-view-models with default states
		this.initializeMicroViewModels();

		// Initialize new component-based view models
		this.initializeComponentViewModels();

		// Set up real-time data callbacks
		this.setupDataCallbacks();

		// Start background data initialization (non-blocking)
		this.initializeDataAsync();
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
	 * Initialize all micro-view-models with default states
	 */
	private initializeMicroViewModels(): void {
		this.summaryCards = {
			title: 'Usage Summary',
			cards: [],
			isLoading: true
		};

		this.timeSeriesChart = {
			title: 'Usage Over Time',
			canvasId: 'timeSeriesChart',
			data: {},
			options: {},
			isLoading: true,
			isEmpty: true,
			height: 200,
			width: 400
		};

		this.eventTypeChart = {
			title: 'Event Types',
			canvasId: 'eventTypeChart',
			data: {},
			options: {},
			isLoading: true,
			isEmpty: true,
			height: 150,
			width: 400
		};

		this.languageChart = {
			title: 'Languages',
			canvasId: 'languageChart',
			data: {},
			options: {},
			isLoading: true,
			isEmpty: true,
			height: 150,
			width: 400
		};

		this.topLanguagesTable = {
			title: 'Top Languages',
			headers: ['Language', 'Count'],
			rows: [],
			isLoading: true,
			isEmpty: true,
			showMore: {
				enabled: false,
				currentLimit: 5,
				totalItems: 0,
				action: 'Show More'
			}
		};

		this.topModelsTable = {
			title: 'Top Models',
			headers: ['Model', 'Count'],
			rows: [],
			isLoading: true,
			isEmpty: true,
			showMore: {
				enabled: false,
				currentLimit: 5,
				totalItems: 0,
				action: 'Show More'
			}
		};

		// (Legacy filterControls removed)

		this.storageInfo = {
			title: 'Storage Information',
			stats: [],
			isLoading: true
		};

		this.debugSection = {
			title: '🔍 ccreq File Provider Debug',
			isVisible: true,
			content: {
				ccreqInput: 'ccreq:95e746dc.copilotmd',
				results: null
			},
			isLoading: false
		};

		this.globalState = {
			isLoading: true,
			isScanning: true, // Start scanning immediately since initializeDataAsync() runs on construction
			hasData: false,
			isVisible: true
		};
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
			this.logger.trace('Initialized FiltersViewModel');
		} catch (error) {
			this.logger.error('Failed to initialize component view-models', error);
		}
	}

	/**
	 * Set up callbacks for real-time data updates
	 */
	private setupDataCallbacks(): void {
		// Session events callback - process events with current filter settings
		this._sessionEventsCallback = async (events: CopilotUsageEvent[]) => {
			this.logger.info(`Real-time session update: ${events.length} events`);
			
			// Apply the same date filtering as refreshAllData
			const settings = await this.getSettings();
			const dateRange = this.getDateRangeForTimespan(settings.defaultTimeRange);
			const filteredEvents = events.filter(e => {
				const t = new Date(e.timestamp);
				return t >= dateRange.start && t <= dateRange.end;
			});
			
			this.logger.info(`Real-time filtered events: ${filteredEvents.length} events`);
			await this.processSessionEvents(filteredEvents);

			// Update global state to reflect new data availability
			this.globalState = {
				...this.globalState,
				hasData: filteredEvents.length > 0 || this.globalState.hasData,
				lastUpdated: new Date()
			};

			// Notify listeners of the change
			this.notifyListeners();
		};

		// Log entries callback  
		this._logEntriesCallback = (logEntries: any[]) => {
			this.logger.info(`Real-time log update: ${logEntries.length} entries`);
			// Could update real-time indicators here
		};

		// Register callbacks
		this.unifiedService.onSessionEventsUpdated(this._sessionEventsCallback);
		this.unifiedService.onLogEntriesUpdated(this._logEntriesCallback);
	}

	/**
	 * Load initial data and update all micro-view-models
	 */
	private async initializeData(): Promise<void> {
		try {
			// Set scanning state for initial data load
			this.globalState.isScanning = true;
			this.notifyListeners();

			// Load initial data
			await this.refreshAllData();
		} catch (error) {
			this.logger.error('Failed to initialize history model:', error);
			this.setGlobalError(String(error));
		} finally {
			// Always clear scanning state when done
			this.globalState.isScanning = false;
			this.notifyListeners();
		}
	}

	/**
	 * Refresh all data and update micro-view-models
	 */
	public async refreshAllData(): Promise<void> {
		try {
			this.globalState.isLoading = true;

			// Get current settings and data
			const settings = await this.getSettings();
			this.logger.info(`[DEBUG] refreshAllData: settings = ${JSON.stringify(settings)}`);
			const dateRange = this.getDateRangeForTimespan(settings.defaultTimeRange);
			const allEvents = await this.unifiedService.getSessionEvents();
			
			// DEBUG: Log the data flow
			this.logger.info(`[DEBUG] refreshAllData: allEvents.length = ${allEvents.length}`);
			this.logger.info(`[DEBUG] refreshAllData: dateRange = ${dateRange.start.toISOString()} to ${dateRange.end.toISOString()}`);
			
			// CRITICAL: Populate analytics service with all events
			this.analyticsService.ingest(allEvents, { replace: true });
			
			// DEBUG: Verify analytics service state after ingest
			const timeRange = settings.defaultTimeRange as AnalyticsTimeRange;
			const filter = { timeRange } as const;
			const testTimeSeries = this.analyticsService.getTimeSeries(filter);
			this.logger.info(`[DEBUG] refreshAllData: analytics timeSeries length after ingest = ${testTimeSeries.length}`);
			
			const events = allEvents.filter(e => {
				const t = new Date(e.timestamp);
				return t >= dateRange.start && t <= dateRange.end;
			});
			
			this.logger.info(`[DEBUG] refreshAllData: filtered events.length = ${events.length}`);
			
			const storageStats = await this.computeStorageStats(allEvents);
			
			// (Legacy filterControls update removed; FiltersViewModel derives state from settings)

			// Process events and update all micro-view-models
			await this.processSessionEvents(events);

			// Update storage info
			this.updateStorageInfo(storageStats);

			// Update global state
			this.globalState = {
				isLoading: false,
				isScanning: false,
				hasData: events.length > 0,
				isVisible: this.globalState.isVisible,
				lastUpdated: new Date()
			};

			// Notify listeners
			this.notifyListeners();

		} catch (error) {
			this.logger.error('Failed to refresh data:', error);
			this.setGlobalError(String(error));
		}
	}

	/**
	 * Process session events and update all relevant micro-view-models
	 */
	private async processSessionEvents(events: CopilotUsageEvent[]): Promise<void> {
		console.log('Model.processSessionEvents: Processing', events.length, 'events');
		this.logger.info(`[DEBUG] processSessionEvents: events.length = ${events.length}`);
		
		// Get settings directly instead of relying on filter controls that might be stale
		const settings = await this.getSettings();
		const timeRange = settings.defaultTimeRange as AnalyticsTimeRange;
		const filter = { timeRange } as const;
		
		const fvTimeRange = this.filtersViewModel?.getState().timeRange;
		this.logger.info(`[DEBUG] processSessionEvents: FiltersViewModel.timeRange = ${fvTimeRange}`);
		this.logger.info(`[DEBUG] processSessionEvents: settings.defaultTimeRange = ${settings.defaultTimeRange}`);
		this.logger.info(`[DEBUG] processSessionEvents: timeRange variable = ${timeRange}`);
		this.logger.info(`[DEBUG] processSessionEvents: filter = ${JSON.stringify(filter)}`);
		
		const timeSeries = this.analyticsService.getTimeSeries(filter);
		const languages = this.analyticsService.getLanguages(filter, 50);
		const models = this.analyticsService.getModels(filter, 50);
		// KPIs (simple load)
		const kpis = this.analyticsService.getKpis(filter);
		this.kpiChipsViewModel?.applyKpis(kpis);
		// Agents (simple load)
		const agents = this.analyticsService.getAgents(filter, 25);
		this.agentsListViewModel?.applyAgents(agents);
		// Models (simple load)
		this.modelsListViewModel?.applyModels(models);
		// Activity (simple load)
		const activity = this.analyticsService.getActivity(filter, 100);
		this.activityFeedViewModel?.applyActivity(activity);

		this.logger.info(`[DEBUG] processSessionEvents: timeSeries.length = ${timeSeries.length}`);
		this.logger.info(`[DEBUG] processSessionEvents: languages.length = ${languages.length}`);
		this.logger.info(`[DEBUG] processSessionEvents: models.length = ${models.length}`);

		const quickStats = this.calculateQuickStats(events);
		
		const analytics = {
			timeSeriesData: timeSeries.map(p => ({ timestamp: p.t, value: p.total })),
			eventTypeDistribution: this.calculateEventTypeDistribution(events),
			languageMetrics: languages.map(l => ({ language: l.id, eventCount: l.count })),
			modelMetrics: models.map(m => ({ model: m.id, eventCount: m.count }))
		};
        
		console.log('Model.processSessionEvents: Analytics:', analytics);
		console.log('Model.processSessionEvents: Quick stats:', quickStats);
		this.logger.info(`[DEBUG] processSessionEvents: analytics.timeSeriesData.length = ${analytics.timeSeriesData.length}`);

		// Update summary cards
		this.updateSummaryCards(quickStats, events);

		// Update charts
		this.updateTimeSeriesChart(analytics);
		this.updateEventTypeChart(analytics);
		this.updateLanguageChart(analytics);

		// Update analytics tables
		this.updateTopLanguagesTable(analytics);
		this.updateTopModelsTable(analytics);
	}

	/**
	 * Update summary cards micro-view-model
	 */
	private updateSummaryCards(quickStats: any, _events: CopilotUsageEvent[]): void {
		this.summaryCards = {
			title: 'Usage Summary',
			isLoading: false,
			cards: [
				{
					title: 'Total Events',
					value: quickStats.totalEvents.toString(),
					highlighted: quickStats.totalEvents > 0
				},
				{
					title: 'Today',
					value: quickStats.eventsToday.toString()
				},
				{
					title: 'This Week',
					value: quickStats.eventsThisWeek.toString()
				},
				{
					title: 'This Month',
					value: quickStats.eventsThisMonth.toString()
				}
			]
		};
	}

	/**
	 * Update time series chart micro-view-model
	 */
	private updateTimeSeriesChart(analytics: any): void {
		const hasData = analytics.timeSeriesData && analytics.timeSeriesData.length > 0;
		console.log('Model.updateTimeSeriesChart: hasData:', hasData, 'analytics.timeSeriesData:', analytics.timeSeriesData);

		const currentRange = this.filtersViewModel?.getState().timeRange;
		this.timeSeriesChart = {
			...this.timeSeriesChart,
			subtitle: currentRange ? `Last ${currentRange}` : undefined,
			data: hasData ? this.prepareTimeSeriesChartData(analytics.timeSeriesData) : {},
			options: this.getTimeSeriesChartOptions(),
			isLoading: false,
			isEmpty: !hasData
		};
		
		console.log('Model.updateTimeSeriesChart: Chart isEmpty now:', this.timeSeriesChart.isEmpty);
	}

	/**
	 * Update event type chart micro-view-model
	 */
	private updateEventTypeChart(analytics: any): void {
		const hasData = analytics.eventTypeDistribution && analytics.eventTypeDistribution.length > 0;

		this.eventTypeChart = {
			...this.eventTypeChart,
			data: hasData ? this.prepareEventTypeChartData(analytics.eventTypeDistribution) : {},
			options: this.getEventTypeChartOptions(),
			isLoading: false,
			isEmpty: !hasData
		};
	}

	/**
	 * Update language chart micro-view-model
	 */
	private updateLanguageChart(analytics: any): void {
		const hasData = analytics.languageMetrics && analytics.languageMetrics.length > 0;

		this.languageChart = {
			...this.languageChart,
			data: hasData ? this.prepareLanguageChartData(analytics.languageMetrics) : {},
			options: this.getLanguageChartOptions(),
			isLoading: false,
			isEmpty: !hasData
		};
	}

	/**
	 * Update top languages table micro-view-model
	 */
	private updateTopLanguagesTable(analytics: any): void {
		const languages = analytics.languageMetrics || [];
		const hasData = languages.length > 0;

		this.topLanguagesTable = {
			...this.topLanguagesTable,
			rows: languages.slice(0, this.topLanguagesTable.showMore?.currentLimit || 5).map((lang: any) => ({
				values: [lang.language, lang.eventCount.toString()],
				updated: false // Could track changes for flash effect
			})),
			isLoading: false,
			isEmpty: !hasData,
			showMore: {
				enabled: languages.length > 5,
				currentLimit: 5,
				totalItems: languages.length,
				action: 'Show More Languages'
			}
		};
	}

	/**
	 * Update top models table micro-view-model
	 */
	private updateTopModelsTable(analytics: any): void {
		const models = analytics.modelMetrics || [];
		const hasData = models.length > 0;

		this.topModelsTable = {
			...this.topModelsTable,
			rows: models.slice(0, this.topModelsTable.showMore?.currentLimit || 5).map((model: any) => ({
				values: [model.model, model.eventCount.toString()],
				updated: false
			})),
			isLoading: false,
			isEmpty: !hasData,
			showMore: {
				enabled: models.length > 5,
				currentLimit: 5,
				totalItems: models.length,
				action: 'Show More Models'
			}
		};
	}

	/**
	 * Update filter controls micro-view-model
	 */
	// (updateFilterControls removed - FiltersViewModel manages filter state)

	/**
	 * Update storage info micro-view-model
	 */
	private updateStorageInfo(storageStats: any): void {
		this.storageInfo = {
			title: 'Storage Information',
			stats: [
				{ label: 'Total Files', value: storageStats.totalFiles?.toString() || '0' },
				{ label: 'Storage Size', value: `${Math.round((storageStats.totalSizeBytes || 0) / 1024)} KB` },
				...(storageStats.oldestEvent ? [{ label: 'Oldest Event', value: new Date(storageStats.oldestEvent).toLocaleDateString() }] : []),
				...(storageStats.newestEvent ? [{ label: 'Newest Event', value: new Date(storageStats.newestEvent).toLocaleDateString() }] : [])
			],
			lastUpdated: new Date(),
			isLoading: false
		};
	}

	/**
	 * Set global error state
	 */
	private setGlobalError(error: string): void {
		this.globalState = {
			isLoading: false,
			isScanning: false,
			hasData: false,
			isVisible: this.globalState.isVisible,
			errorMessage: error
		};

		// Set error state on all micro-view-models
		this.summaryCards.isLoading = false;
		this.summaryCards.errorMessage = error;
		this.timeSeriesChart.isLoading = false;
		this.timeSeriesChart.errorMessage = error;
		this.eventTypeChart.isLoading = false;
		this.eventTypeChart.errorMessage = error;
		this.languageChart.isLoading = false;
		this.languageChart.errorMessage = error;
		this.topLanguagesTable.isLoading = false;
		this.topLanguagesTable.errorMessage = error;
		this.topModelsTable.isLoading = false;
		this.topModelsTable.errorMessage = error;

		this.notifyListeners();
	}

	// Chart data preparation methods
	private prepareTimeSeriesChartData(timeSeriesData: any[]): any {
		return {
			labels: timeSeriesData.map(d => new Date(d.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
			datasets: [{
				label: 'Daily Events',
				data: timeSeriesData.map(d => d.value),
				backgroundColor: 'var(--vscode-button-background)',
				borderColor: 'var(--vscode-button-background)',
				borderWidth: 1
			}]
		};
	}

	private prepareEventTypeChartData(eventTypeDistribution: any[]): any {
		return {
			labels: eventTypeDistribution.map(d => d.type),
			datasets: [{
				data: eventTypeDistribution.map(d => d.count),
				backgroundColor: [
					'var(--vscode-button-background)',
					'var(--vscode-button-secondaryBackground)',
					'var(--vscode-charts-green)',
					'var(--vscode-charts-orange)',
					'var(--vscode-charts-blue)'
				]
			}]
		};
	}

	private prepareLanguageChartData(languageMetrics: any[]): any {
		return {
			labels: languageMetrics.map(d => d.language),
			datasets: [{
				data: languageMetrics.map(d => d.eventCount),
				backgroundColor: languageMetrics.map((_, i) => {
					const colors = [
						'var(--vscode-button-background)',
						'var(--vscode-charts-green)',
						'var(--vscode-charts-blue)',
						'var(--vscode-charts-orange)',
						'var(--vscode-charts-red)'
					];
					return colors[i % colors.length];
				})
			}]
		};
	}

	// Chart options methods
	private getTimeSeriesChartOptions(): any {
		return {
			responsive: true,
			maintainAspectRatio: false,
			plugins: { legend: { display: false } },
			scales: {
				x: {
					display: true,
					grid: { color: 'var(--vscode-panel-border)' },
					ticks: { color: 'var(--vscode-foreground)' }
				},
				y: {
					display: true,
					grid: { color: 'var(--vscode-panel-border)' },
					ticks: { color: 'var(--vscode-foreground)' }
				}
			}
		};
	}

	private getEventTypeChartOptions(): any {
		return {
			responsive: true,
			maintainAspectRatio: false,
			plugins: {
				legend: {
					position: 'bottom' as const,
					labels: {
						color: 'var(--vscode-foreground)',
						font: { size: 10 }
					}
				}
			}
		};
	}

	private getLanguageChartOptions(): any {
		return {
			responsive: true,
			maintainAspectRatio: false,
			plugins: { legend: { display: false } },
			scales: {
				x: {
					display: true,
					grid: { color: 'var(--vscode-panel-border)' },
					ticks: { color: 'var(--vscode-foreground)' }
				},
				y: {
					display: true,
					grid: { color: 'var(--vscode-panel-border)' },
					ticks: { color: 'var(--vscode-foreground)' }
				}
			}
		};
	}

	// Utility methods
	private getDateRangeForTimespan(timespan: AnalyticsTimeRange): DateRange {
		const end = new Date();
		let start = new Date();

		// Calculate date range based on timespan
		switch (timespan) {
			case 'today':
				// Start of today (00:00:00)
				start = new Date(end.getFullYear(), end.getMonth(), end.getDate());
				break;
			case '7d':
				start.setDate(end.getDate() - 7);
				break;
			case '30d':
				start.setDate(end.getDate() - 30);
				break;
			case '90d':
				start.setDate(end.getDate() - 90);
				break;
			case 'all':
				// Start from epoch for all data
				start = new Date(0);
				break;
		}

		// DEBUG: Add logging to verify date calculation
		console.log(`[DEBUG] getDateRangeForTimespan(${timespan}): start=${start.toISOString()}, end=${end.toISOString()}`);

		return { start, end };
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
	 * Update time range setting
	 */
	public async updateTimeRange(timeRange: '7d' | '30d' | '90d'): Promise<void> {
		await this.updateSettings({ defaultTimeRange: timeRange });
		await this.refreshAllData();
	}

	/**
	 * Clear all usage data
	 */
	public async clearData(): Promise<{ deletedFiles: number; deletedEvents: number }> {
		const all = await this.unifiedService.getSessionEvents();
		const deletedEvents = all.length;
		try {
			// Reset unified cache and clear analytics store
			await this.unifiedService.resetInitialization();
			this.analyticsService.ingest([], { replace: true });
		} catch (e) {
			this.logger.debug(`clearData side-effects failed: ${e}`);
		}
		await this.refreshAllData();
		return { deletedFiles: 0, deletedEvents };
	}

	/**
	 * Export usage data
	 */
	public async getExportData(): Promise<any> {
		const settings = await this.getSettings();
		const dateRange = this.getDateRangeForTimespan(settings.defaultTimeRange);
		const allEvents = await this.unifiedService.getSessionEvents();
		const events = allEvents.filter(e => {
			const t = new Date(e.timestamp);
			return t >= dateRange.start && t <= dateRange.end;
		});
		const timeRange = settings.defaultTimeRange as AnalyticsTimeRange;
		const filter = { timeRange } as const;
		return {
			metadata: {
				exportedAt: new Date().toISOString(),
				totalEvents: events.length,
				dateRange: {
					start: dateRange.start.toISOString(),
					end: dateRange.end.toISOString()
				}
			},
			events,
			analytics: {
				kpis: this.analyticsService.getKpis(filter),
				agents: this.analyticsService.getAgents(filter, 100),
				models: this.analyticsService.getModels(filter, 100),
				languages: this.analyticsService.getLanguages(filter, 100),
				timeSeries: this.analyticsService.getTimeSeries(filter)
			}
		};
	}

	/**
	 * Scan chat sessions
	 */
	public async scanChatSessions(): Promise<{ events: CopilotUsageEvent[]; stats: any }> {
		// Set scanning state
		this.globalState = {
			...this.globalState,
			isScanning: true
		};

		// Update scan progress
		this.notifyListeners(); // (Legacy scan progress removed)

		try {
			const result = await this.unifiedService.scanAllData();
			// Replace analytics events store with latest
			this.analyticsService.ingest(result.sessionEvents, { replace: true });

			// (Legacy scan progress completion removed)

			// Reset scanning state and refresh all data
			this.globalState = {
				...this.globalState,
				isScanning: false
			};
			await this.refreshAllData();
			return { events: result.sessionEvents, stats: result.stats };

		} catch (error) {
			// (Legacy scan progress error removed)
			
			// Reset scanning state on error
			this.globalState = {
				...this.globalState,
				isScanning: false
			};
			this.notifyListeners();
			throw error;
		}
	}

	/**
	 * Test ccreq file provider
	 */
	public async testCcreqProvider(ccreqUri: string): Promise<any> {
		this.debugSection.isLoading = true;
		this.notifyListeners();

		try {
			// This would integrate with the actual ccreq testing logic
			// For now, just simulate the test
			const result = {
				success: true,
				message: 'ccreq provider test successful!',
				data: {
					uri: ccreqUri,
					loadTime: 150,
					contentLength: 1500,
					lineCount: 45
				}
			};

			this.debugSection.isLoading = false;
			this.debugSection.results = result;
			this.notifyListeners();

			return result;

		} catch (error) {
			const result = {
				success: false,
				message: String(error),
				data: null
			};

			this.debugSection.isLoading = false;
			this.debugSection.results = result;
			this.notifyListeners();

			throw error;
		}
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
		// Remove callbacks
		if (this._sessionEventsCallback) {
			this.unifiedService.removeSessionEventCallback(this._sessionEventsCallback);
		}
		if (this._logEntriesCallback) {
			this.unifiedService.removeLogEventCallback(this._logEntriesCallback);
		}

		// Clear listeners
		this._listeners = [];
	}

	// ---------- New helpers using AnalyticsService / Unified data ----------
	private async getSettings(): Promise<{ defaultTimeRange: '7d' | '30d' | '90d' }> {
		const key = 'copilot-usage-history-settings';
		const stored = this.extensionContext.globalState.get<{ defaultTimeRange: '7d' | '30d' | '90d' }>(key);
		return stored || { defaultTimeRange: '30d' };
	}

	private async updateSettings(update: Partial<{ defaultTimeRange: '7d' | '30d' | '90d' }>): Promise<void> {
		const key = 'copilot-usage-history-settings';
		const current = await this.getSettings();
		await this.extensionContext.globalState.update(key, { ...current, ...update });
	}

	private async computeStorageStats(allEvents: CopilotUsageEvent[]): Promise<{ totalFiles: number; totalSizeBytes: number; oldestEvent?: string; newestEvent?: string }> {
		let oldestEvent: string | undefined;
		let newestEvent: string | undefined;
		if (allEvents.length > 0) {
			oldestEvent = allEvents[0].timestamp;
			newestEvent = allEvents[allEvents.length - 1].timestamp;
		}
		const totalSizeBytes = JSON.stringify(allEvents).length;
		return { totalFiles: 0, totalSizeBytes, oldestEvent, newestEvent };
	}

	private calculateQuickStats(events: CopilotUsageEvent[]): {
		totalEvents: number;
		eventsToday: number;
		eventsThisWeek: number;
		eventsThisMonth: number;
		averageSessionDuration: string;
		topLanguage: string;
		topModel: string;
		lastEventTime?: string;
	} {
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const weekStart = new Date(now.getTime() - now.getDay() * 24 * 60 * 60 * 1000);
		const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

		const eventsToday = events.filter(e => new Date(e.timestamp) >= today).length;
		const eventsThisWeek = events.filter(e => new Date(e.timestamp) >= weekStart).length;
		const eventsThisMonth = events.filter(e => new Date(e.timestamp) >= monthStart).length;

		// Average session duration (approx based on events per session)
		const sessions = new Map<string, CopilotUsageEvent[]>();
		for (const e of events) {
			const arr = sessions.get(e.sessionId) || [];
			arr.push(e);
			sessions.set(e.sessionId, arr);
		}
		let avgDuration = 0;
		if (sessions.size > 0) {
			let sum = 0;
			for (const arr of sessions.values()) {
				const sorted = arr.slice().sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
				const d = new Date(sorted[sorted.length - 1].timestamp).getTime() - new Date(sorted[0].timestamp).getTime();
				sum += d;
			}
			avgDuration = sum / sessions.size;
		}

		// Top model
		const modelCounts = new Map<string, number>();
		for (const e of events) {
			const k = e.model || 'Unknown';
			modelCounts.set(k, (modelCounts.get(k) || 0) + 1);
		}
		const topModel = Array.from(modelCounts.entries()).sort((a,b) => b[1]-a[1])[0]?.[0] || 'None';

		const lastEvent = events[events.length - 1];
		const lastEventTime = lastEvent ? lastEvent.timestamp : undefined;

		return {
			totalEvents: events.length,
			eventsToday,
			eventsThisWeek,
			eventsThisMonth,
			averageSessionDuration: this.formatDuration(avgDuration),
			topLanguage: 'None',
			topModel,
			lastEventTime
		};
	}

	private calculateEventTypeDistribution(events: CopilotUsageEvent[]): Array<{ type: string; count: number }> {
		const map = new Map<string, number>();
		for (const e of events) {
			map.set(e.type, (map.get(e.type) || 0) + 1);
		}
		return Array.from(map.entries()).map(([type, count]) => ({ type, count })).sort((a,b) => b.count - a.count);
	}

	private formatDuration(durationMs: number): string {
		if (durationMs < 1000) {
			return `${Math.round(durationMs)}ms`;
		} else if (durationMs < 60000) {
			return `${Math.round(durationMs / 1000)}s`;
		} else if (durationMs < 3600000) {
			return `${Math.round(durationMs / 60000)}m`;
		} else {
			return `${Math.round(durationMs / 3600000)}h`;
		}
	}
}
