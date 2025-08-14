import { AnalyticsService, Kpis } from '../../../../services/analytics-service';
import { ILogger } from '../../../../types/logger';
import { CopilotUsageHistoryModel } from '../../copilot-usage-history-model';

export interface KpiChip {
	id: string;
	label: string;
	value: string;
}

export interface KpiChipsState {
	chips: KpiChip[];
	isLoading: boolean;
	lastUpdated?: Date;
}

/**
 * Minimal KPI chips view model (intentionally lean – no deltas, formatting extras, or per‑chip states yet)
 */
export class KpiChipsViewModel {
	private state: KpiChipsState = { chips: [], isLoading: true };
	private listeners: Array<() => void> = [];

	constructor(private model: CopilotUsageHistoryModel, private analytics: AnalyticsService, private logger: ILogger) {}

	getState(): KpiChipsState { return this.state; }

	onDidChange(listener: () => void): void { this.listeners.push(listener); }

	setLoading(flag: boolean): void { this.patch({ isLoading: flag }); }

	/** Apply raw KPI numbers from AnalyticsService */
	applyKpis(kpis: Kpis): void {
		const chips: KpiChip[] = [
			{ id: 'requests', label: 'Requests', value: kpis.requests.toString() },
			{ id: 'sessions', label: 'Sessions', value: kpis.sessions.toString() },
			{ id: 'files', label: 'Files', value: kpis.files.toString() },
			{ id: 'edits', label: 'Edits', value: kpis.edits.toString() },
			{ id: 'latencyMsMedian', label: 'Median Latency (ms)', value: Math.round(kpis.latencyMsMedian).toString() },
			{ id: 'editRatio', label: 'Edit Ratio', value: (kpis.editRatio * 100).toFixed(1) + '%' },
			{ id: 'models', label: 'Models', value: kpis.models.toString() },
			{ id: 'agents', label: 'Agents', value: kpis.agents.toString() }
		];
		this.patch({ chips, isLoading: false, lastUpdated: new Date() });
	}

	private patch(p: Partial<KpiChipsState>): void {
		this.state = { ...this.state, ...p };
		for (const l of this.listeners) {
			try { l(); } catch (e) { this.logger.error('KpiChipsViewModel listener error', e); }
		}
	}
}
