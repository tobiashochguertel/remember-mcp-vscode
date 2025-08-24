import { AnalyticsService, Kpis, TimeRange } from '../../../../services/analytics-service';
import { ILogger } from '../../../../types/logger';
import { CopilotUsageHistoryModel } from '../../copilot-usage-history-model';

export interface InsightItem {
	text: string;
}

export interface InsightsVMState {
	items: InsightItem[];
	isLoading: boolean;
	lastUpdated?: Date;
}

export class InsightsViewModel {
	private state: InsightsVMState = { items: [], isLoading: true };
	private listeners: Array<() => void> = [];

	constructor(
		private model: CopilotUsageHistoryModel,
		private analytics: AnalyticsService,
		private logger: ILogger
	) {}

	getState(): InsightsVMState { return this.state; }
	onDidChange(listener: () => void): void { this.listeners.push(listener); }
	setLoading(flag: boolean): void { this.patch({ isLoading: flag }); }

	loadInsights(timeRange: TimeRange): void {
		try {
			this.setLoading(true);
			const filter = { timeRange } as const;
			const kpis = this.analytics.getKpis(filter);
			this.applyFromKpis(kpis);
		} catch (e) {
			this.logger.error('InsightsViewModel.loadInsights failed', e);
			this.patch({ isLoading: false });
		}
	}

	applyFromKpis(kpis: Kpis): void {
		const items: InsightItem[] = [];
		if (kpis.turns > 0) {
			items.push({ text: `Median latency ${Math.round(kpis.latencyMsMedian)} ms across ${kpis.turns} turns.` });
		}
		if (kpis.edits > 0) {
			items.push({ text: `${kpis.edits} edit turns with ${kpis.fileModifications} total file modifications.` });
			items.push({ text: `Edit productivity ${kpis.editProductivity.toFixed(1)} files changed per edit.` });
		} else if (kpis.turns > 0) {
			items.push({ text: `Edit ratio ${(kpis.editRatio * 100).toFixed(1)}%. Try prompting for edits to increase impact.` });
		}
		this.patch({ items, isLoading: false, lastUpdated: new Date() });
	}

	private patch(p: Partial<InsightsVMState>): void {
		this.state = { ...this.state, ...p };
		for (const l of this.listeners) {
			try { l(); } catch (e) { this.logger.error('InsightsViewModel listener error', e); }
		}
	}
}
