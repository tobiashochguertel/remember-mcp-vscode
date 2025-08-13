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
		// Initialize state from model
		this.state = {
			timeRange: model.filterControls.timeRange.current as FiltersState['timeRange'],
			workspace: 'all',
			agentOptions: [],
			modelOptions: []
		};
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
						await this.model.updateTimeRange(event.patch.timeRange);
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
