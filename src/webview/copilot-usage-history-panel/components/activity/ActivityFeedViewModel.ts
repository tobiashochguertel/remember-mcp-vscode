import { AnalyticsService, ActivityItem, TimeRange } from '../../../../services/analytics-service';
import { ILogger } from '../../../../types/logger';
import { CopilotUsageHistoryModel } from '../../copilot-usage-history-model';

export interface ActivityFeedVMState {
	items: ActivityItem[];
	isLoading: boolean;
	lastUpdated?: Date;
}

// Simple activity feed view model (mirrors Agents/Models patterns)
export class ActivityFeedViewModel {
	private state: ActivityFeedVMState = { items: [], isLoading: true };
	private listeners: Array<() => void> = [];

	constructor(private model: CopilotUsageHistoryModel, private analytics: AnalyticsService, private logger: ILogger) {}

	getState(): ActivityFeedVMState { return this.state; }
	onDidChange(listener: () => void): void { this.listeners.push(listener); }
	setLoading(flag: boolean): void { this.patch({ isLoading: flag }); }

	loadActivity(timeRange: TimeRange): void {
		try {
			this.setLoading(true);
			const filter = { timeRange } as const;
			const items = this.analytics.getActivity(filter, 100);
			this.patch({ items, isLoading: false, lastUpdated: new Date() });
		} catch (e) {
			this.logger.error('ActivityFeedViewModel.loadActivity failed', e);
			this.patch({ isLoading: false });
		}
	}

	applyActivity(items: ActivityItem[]): void {
		this.patch({ items, isLoading: false, lastUpdated: new Date() });
	}

	private patch(p: Partial<ActivityFeedVMState>): void {
		this.state = { ...this.state, ...p };
		for (const l of this.listeners) {
			try { l(); } catch (e) { this.logger.error('ActivityFeedViewModel listener error', e); }
		}
	}
}
