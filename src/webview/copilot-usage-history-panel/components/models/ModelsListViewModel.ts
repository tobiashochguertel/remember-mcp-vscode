import { AnalyticsService, ModelStat, TimeRange } from '../../../../services/analytics-service';
import { ILogger } from '../../../../types/logger';
import { CopilotUsageHistoryModel } from '../../copilot-usage-history-model';

export interface ModelsListVMState {
	items: ModelStat[];
	isLoading: boolean;
	lastUpdated?: Date;
}

/**
 * Minimal Models list view model – mirrors AgentsListViewModel (simple state container)
 */
export class ModelsListViewModel {
	private state: ModelsListVMState = { items: [], isLoading: true };
	private listeners: Array<() => void> = [];

	constructor(private model: CopilotUsageHistoryModel, private analytics: AnalyticsService, private logger: ILogger) {}

	getState(): ModelsListVMState { return this.state; }
	onDidChange(listener: () => void): void { this.listeners.push(listener); }
	setLoading(flag: boolean): void { this.patch({ isLoading: flag }); }

	loadModels(timeRange: TimeRange): void {
		try {
			this.setLoading(true);
			const filter = { timeRange } as const;
			const models = this.analytics.getModels(filter, 50);
			this.patch({ items: models, isLoading: false, lastUpdated: new Date() });
		} catch (e) {
			this.logger.error('ModelsListViewModel.loadModels failed', e);
			this.patch({ isLoading: false });
		}
	}

	applyModels(models: ModelStat[]): void {
		this.patch({ items: models, isLoading: false, lastUpdated: new Date() });
	}

	private patch(p: Partial<ModelsListVMState>): void {
		this.state = { ...this.state, ...p };
		for (const l of this.listeners) {
			try { l(); } catch (e) { this.logger.error('ModelsListViewModel listener error', e); }
		}
	}
}
