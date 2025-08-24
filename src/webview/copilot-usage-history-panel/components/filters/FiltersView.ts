import { ComponentBase, ComponentMessage } from '../shared/ComponentBase';
import { FiltersViewModel } from './FiltersViewModel';
import { CopilotUsageHistoryModel } from '../../copilot-usage-history-model';
import { ILogger } from '../../../../types/logger';
import * as vscode from 'vscode';

export interface FiltersState {
	timeRange: 'today' | '7d' | '30d' | '90d' | 'all';
	workspace: 'current' | 'all';
	agentId?: string;
	modelId?: string;
	agentOptions?: string[];
	modelOptions?: string[];
}

export interface FiltersActions {
	applyFilter(patch: Partial<FiltersState>): void;
	refresh(): void;
}

/**
 * Filters Component - manages filter state and user interactions via PostMessage
 */
export class FiltersView extends ComponentBase {
	private viewModel: FiltersViewModel;

	constructor(
		webview: vscode.Webview,
		private model: CopilotUsageHistoryModel,
		private logger: ILogger
	) {
		super(webview, 'filters-container');
		this.viewModel = this.model.filtersViewModel;

		// Subscribe to model changes
		this._disposables.push({
			dispose: this.viewModel.subscribe(() => {
				this.onStateChanged();
			})
		});

		// Send initial content immediately
		this.onStateChanged();
	}

	/**
	 * Handle messages related to filtering
	 */
	async handleMessage(message: ComponentMessage): Promise<boolean> {
		switch (message.type) {
			case 'applyFilter':
				await this.handleApplyFilter(message);
				return true;
			case 'refresh':
				await this.handleRefresh();
				return true;
			default:
				return false;
		}
	}

	/**
	 * Handle filter application
	 */
	private async handleApplyFilter(message: ComponentMessage): Promise<void> {
		try {
			const patch: any = {};
			if (message.timeRange) { patch.timeRange = message.timeRange; }
			if (message.workspace) { patch.workspace = message.workspace; }
			if (message.agentIds) { patch.agents = message.agentIds; }
			if (message.modelIds) { patch.models = message.modelIds; }
			
			if (Object.keys(patch).length > 0) {
				await this.model.updateFilters(patch);
				this.logger.debug?.('Applied filter patch', patch);
			}
		} catch (error) {
			this.logger.error('Failed to apply filter patch', error);
		}
	}

	/**
	 * Handle refresh request
	 */
	private async handleRefresh(): Promise<void> {
		try {
			await this.model.refreshAllData();
			this.logger.info('Data refreshed from filters component');
		} catch (error) {
			this.logger.error('Error refreshing data from filters:', error);
		}
	}

	/**
	 * Render the filters HTML
	 */
	protected render(): string {
		const filtersVmState = this.viewModel.getState();
		const state: FiltersState = {
			timeRange: filtersVmState.timeRange,
			workspace: 'all',
			agentOptions: filtersVmState.agentOptions,
			modelOptions: filtersVmState.modelOptions,
			agentId: undefined,
			modelId: undefined
		};

		const timeOptions = [
			{ v: 'today', l: 'Today' },
			{ v: '7d', l: 'Last 7d' },
			{ v: '30d', l: 'Last 30d' },
			{ v: '90d', l: 'Last 90d' },
			{ v: 'all', l: 'All Time' }
		];
		const wsOptions = [
			{ v: 'current', l: 'Current' },
			{ v: 'all', l: 'All Workspaces' }
		];

		const agentOptions = (state.agentOptions || []).map((id: string) => `<option value="${id}" ${id===state.agentId?'selected':''}>${id}</option>`).join('');
		const modelOptions = (state.modelOptions || []).map((id: string) => `<option value="${id}" ${id===state.modelId?'selected':''}>${id}</option>`).join('');

		return `
			<div class="filters" id="filters_bar">
				<select id="flt_time" class="vscode-select">
					${timeOptions.map(o => `<option value=\"${o.v}\" ${o.v===state.timeRange?'selected':''}>${o.l}</option>`).join('')}
				</select>
				<select id="flt_ws" class="vscode-select">
					${wsOptions.map(o => `<option value=\"${o.v}\" ${o.v===state.workspace?'selected':''}>${o.l}</option>`).join('')}
				</select>
				<select id="flt_agent" class="vscode-select">
					<option value="">Agent</option>
					${agentOptions}
				</select>
				<select id="flt_model" class="vscode-select">
					<option value="">Model</option>
					${modelOptions}
				</select>
				<button id="flt_refresh" class="vscode-button">Refresh</button>
			</div>
		`;
	}

	/**
	 * Called when the model state changes - component updates itself
	 */
	private onStateChanged(): void {
		const html = this.render();
		this.updateView(html);
	}
}
