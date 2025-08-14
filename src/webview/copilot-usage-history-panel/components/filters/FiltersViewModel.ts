import { ComponentViewModel } from '../shared/ComponentBase';
import type { FiltersState } from './FiltersView';
import type { CopilotUsageHistoryModel } from '../../copilot-usage-history-model';
import type { ILogger } from '../../../../types/logger';

export type FiltersEvent =
	| { type: 'applyFilter'; patch: Partial<FiltersState> }
	| { type: 'refresh' };

export class FiltersViewModel implements ComponentViewModel<FiltersState, FiltersEvent> {
	private state: FiltersState;
	private listeners: Array<(s: FiltersState) => void> = [];

	constructor(private readonly model: CopilotUsageHistoryModel, private readonly logger: ILogger) {
		// Initialize state from model settings (legacy filterControls removed)
		const initial: FiltersState = {
			timeRange: '30d',
			workspace: 'all',
			agentOptions: [],
			modelOptions: []
		};
		this.state = initial;

		// Async sync with stored settings after state assignment
		const self = this;
		(async () => {
			try {
				const settings = await (model as any).getSettings();
				if (settings?.defaultTimeRange && self.state.timeRange !== settings.defaultTimeRange) {
					self.state = { ...self.state, timeRange: settings.defaultTimeRange };
					self.notify();
				}
			} catch (e) {
				self.logger.warn?.('FiltersViewModel settings sync failed', e);
			}
		})();
	}

	getState(): FiltersState {
		return this.state;
	}

	subscribe(listener: (state: FiltersState) => void): () => void {
		this.listeners.push(listener);
		return () => {
			this.listeners = this.listeners.filter(l => l !== listener);
		};
	}

	private notify(): void {
		for (const l of this.listeners) {
			try { l(this.state); } catch (e) { this.logger.error('FiltersViewModel notify error', e); }
		}
	}

	async handle(event: FiltersEvent): Promise<void> {
		try {
			switch (event.type) {
				case 'applyFilter': {
					const prev = this.state;
					this.state = { ...this.state, ...event.patch };
					this.notify();
					if (event.patch.timeRange && event.patch.timeRange !== prev.timeRange) {
						const tr = event.patch.timeRange;
						if (tr === 'all') {
							// Persist a sentinel (use '90d' internally for settings) then fetch full range via refresh
							await this.model.updateTimeRange('90d');
							// Additional handling for 'all' could be added later if model/settings extended
						} else {
							await this.model.updateTimeRange(tr as 'today' | '7d' | '30d' | '90d');
						}
					} else {
						await this.model.refreshAllData();
					}
					break;
				}
				case 'refresh': {
					await this.model.refreshAllData();
					break;
				}
			}
		} catch (error) {
			this.logger.error('FiltersViewModel handle error:', error);
		}
	}
}
