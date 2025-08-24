import { AnalyticsService, Kpis } from '../../../../services/analytics-service';
import { ILogger } from '../../../../types/logger';
import { IComponentModel } from '../shared/IComponentModel';
import type { GlobalFilters } from '../../copilot-usage-history-model';

export interface KpiChip {
	id: string;
	label: string;
	value: string;
	tooltip?: string;
}

export interface KpiChipsState {
	chips: KpiChip[];
	isLoading: boolean;
	lastUpdated?: Date;
}

/**
 * KPI Chips Component Model implementing the new IComponentModel framework
 * This is an example of how to convert existing models to the new architecture
 */
export class KpiChipsComponentModel implements IComponentModel {
	public readonly id = 'kpis';
	private state: KpiChipsState = { chips: [], isLoading: true };
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
			
			// Get KPI data from analytics service
			const kpis = this.analyticsService.getKpis(filter);
			this.applyKpis(kpis);
			
		} catch (error) {
			this.logger.error('KpiChipsComponentModel.refresh failed:', error);
			this.setLoading(false);
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
	getState(): KpiChipsState {
		return this.state;
	}

	setLoading(flag: boolean): void {
		this.patch({ isLoading: flag });
	}

	/** Apply raw KPI numbers from AnalyticsService */
	applyKpis(kpis: Kpis): void {
		const chips: KpiChip[] = [
			{ id: 'sessions', label: 'Sessions', value: kpis.sessions.toString(), tooltip: 'Unique chat sessions in the selected period' },
			{ id: 'turns', label: 'Turns', value: kpis.turns.toString(), tooltip: 'Total user turns (messages/requests) across sessions' },
			{ id: 'requests', label: 'Requests', value: kpis.requests.toString(), tooltip: 'Total model/tool request rounds executed by Copilot' },
			{ id: 'files', label: 'Files', value: kpis.files.toString(), tooltip: 'Unique files referenced across all turns' },
			{ id: 'edits', label: 'Edits', value: kpis.edits.toString(), tooltip: 'Number of edit-type turns (code changes suggested/applied)' },
			{ id: 'editRatio', label: 'Edit Ratio', value: (kpis.editRatio * 100).toFixed(1) + '%', tooltip: 'Share of turns that were edits (edits ÷ turns)' },
			{ id: 'fileModifications', label: 'File Mods', value: kpis.fileModifications.toString(), tooltip: 'Total individual file modifications made across all edit turns' },
			{ id: 'editProductivity', label: 'Edit Productivity', value: kpis.editProductivity.toFixed(1), tooltip: 'Average file modifications per edit turn (file mods ÷ edit turns)' },
			{ id: 'latencyMsMedian', label: 'Median Latency (ms)', value: Math.round(kpis.latencyMsMedian).toString(), tooltip: 'Median end-to-end latency per turn (milliseconds)' },
			{ id: 'models', label: 'Models', value: kpis.models.toString(), tooltip: 'Unique AI models used' },
			{ id: 'agents', label: 'Agents', value: kpis.agents.toString(), tooltip: 'Unique Copilot agents used' }
		];
		this.patch({ chips, isLoading: false, lastUpdated: new Date() });
	}

	private patch(p: Partial<KpiChipsState>): void {
		this.state = { ...this.state, ...p };
		for (const l of this.listeners) {
			try {
				l();
			} catch (e) {
				this.logger.error('KpiChipsComponentModel listener error', e);
			}
		}
	}
}