import { IComponentModel } from '../shared/IComponentModel';
import type { FiltersState } from './FiltersView';
import type { CopilotUsageHistoryModel, GlobalFilters } from '../../copilot-usage-history-model';
import type { ILogger } from '../../../../types/logger';

export type FiltersEvent =
	| { type: 'applyFilter'; patch: Partial<FiltersState> }
	| { type: 'refresh' };

/**
 * Filters Component Model implementing the new IComponentModel framework
 */
export class FiltersComponentModel implements IComponentModel {
	public readonly id = 'filters';
	private state: FiltersState;

	constructor(
		private readonly model: CopilotUsageHistoryModel,
		private readonly logger: ILogger
	) {
		// Initialize state from current model filters
		const gf = model.getFilters();
		this.state = this.fromGlobalFilters(gf);
	}

	/**
	 * Refresh data based on current filters (implements IComponentModel)
	 */
	async refresh(filters: GlobalFilters): Promise<void> {
		// Update our state to match the current filters
		this.state = this.fromGlobalFilters(filters);
	}

	/**
	 * Check if loading (implements IComponentModel)
	 */
	isLoading(): boolean {
		return false; // Filters don't have loading state
	}

	/**
	 * Dispose resources (implements IComponentModel)
	 */
	dispose(): void {
		// No resources to dispose
	}

	// Public API methods for views
	getState(): FiltersState {
		return this.state;
	}

	async handle(event: FiltersEvent): Promise<void> {
		try {
			switch (event.type) {
				case 'applyFilter': {
					// Use new simple API: get filters, modify them, update
					const filters = this.model.getFilters();
					if (event.patch.timeRange) {
						filters.timeRange = event.patch.timeRange;
					}
					if (event.patch.workspace) {
						filters.workspace = event.patch.workspace;
					}
					// Note: agentIds/modelIds from UI need to be mapped to agents/models arrays
					await this.model.updateFilters(filters);
					break;
				}
				case 'refresh': {
					await this.model.refreshAllData();
					break;
				}
			}
		} catch (error) {
			this.logger.error('FiltersComponentModel handle error:', error);
		}
	}

	private fromGlobalFilters(f: GlobalFilters): FiltersState {
		return {
			timeRange: f.timeRange,
			workspace: (f.workspace === 'current' ? 'current' : 'all'),
			agentOptions: [], // TODO: populate when agent/model filter selectors added
			modelOptions: []
		};
	}
}