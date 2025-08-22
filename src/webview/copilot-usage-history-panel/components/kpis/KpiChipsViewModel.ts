import { AnalyticsService, Kpis } from '../../../../services/analytics-service';
import { ILogger } from '../../../../types/logger';
import { CopilotUsageHistoryModel } from '../../copilot-usage-history-model';

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
			try { l(); } catch (e) { this.logger.error('KpiChipsViewModel listener error', e); }
		}
	}
}
