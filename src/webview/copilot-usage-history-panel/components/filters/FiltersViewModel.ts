import { ComponentViewModel } from '../shared/ComponentBase';
import type { FiltersState } from './FiltersView';
import type { CopilotUsageHistoryModel, GlobalFilters } from '../../copilot-usage-history-model';
import type { ILogger } from '../../../../types/logger';

export type FiltersEvent =
	| { type: 'applyFilter'; patch: Partial<FiltersState> }
	| { type: 'refresh' };

export class FiltersViewModel implements ComponentViewModel<FiltersState, FiltersEvent> {
	private state: FiltersState;
	private listeners: Array<(s: FiltersState) => void> = [];

	constructor(private readonly model: CopilotUsageHistoryModel, private readonly logger: ILogger) {
		// Mirror model global filters; options arrays remain empty until populated by other components
		const gf = model.getFilters();
		this.state = this.fromGlobalFilters(gf);
		// Subscribe to model filter changes
		this.model.onFiltersChanged(f => {
			this.state = this.fromGlobalFilters(f);
			this.notify();
		});
	}

	private fromGlobalFilters(f: GlobalFilters): FiltersState {
		return {
			timeRange: f.timeRange,
			workspace: (f.workspace === 'current' ? 'current' : 'all'),
			agentOptions: [], // TODO: populate when agent/model filter selectors added
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
					await this.model.updateFilters(event.patch as any); // patch narrowing handled in model
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
