import { ComponentBase, ComponentMessage } from '../shared/ComponentBase';
import { FiltersComponentModel } from './FiltersComponentModel';
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
	private componentModel: FiltersComponentModel;

	constructor(
		private webview: vscode.Webview,
		componentModel: FiltersComponentModel,
		private logger: ILogger
	) {
		super('filters-container');
		this.componentModel = componentModel;
	}

	/**
	 * Handle messages related to filtering
	 */
	public async handleMessage(message: ComponentMessage): Promise<boolean> {
		if (message.component !== 'filters') {
			return false;
		}

		switch (message.action) {
			case 'applyFilter':
				if (message.data?.id && message.data?.value !== undefined) {
					// Map the element ID to the filter property
					const filterMap: { [key: string]: keyof FiltersState } = {
						'flt_time': 'timeRange',
						'flt_ws': 'workspace', 
						'flt_agent': 'agentId',
						'flt_model': 'modelId'
					};
					
					const filterProperty = filterMap[message.data.id];
					if (filterProperty) {
						const patch: Partial<FiltersState> = {};
						patch[filterProperty] = message.data.value || undefined;
						this.componentModel.handle({ type: 'applyFilter', patch });
					}
				}
				return true;
				
			default:
				return false;
		}
	}

	/**
	 * Render the filters HTML
	 */
	public render(): string {
		const cmState = this.componentModel.getState();
		const state: FiltersState = {
			timeRange: cmState.timeRange,
			workspace: 'all',
			agentOptions: cmState.agentOptions,
			modelOptions: cmState.modelOptions,
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
				<select id="flt_time" data-action="applyFilter" data-component="filters" data-filter="timeRange" class="vscode-select">
					${timeOptions.map(o => `<option value="${o.v}" ${o.v===state.timeRange?'selected':''}>${o.l}</option>`).join('')}
				</select>
				<select id="flt_ws" data-action="applyFilter" data-component="filters" data-filter="workspace" class="vscode-select">
					${wsOptions.map(o => `<option value="${o.v}" ${o.v===state.workspace?'selected':''}>${o.l}</option>`).join('')}
				</select>
				<select id="flt_agent" data-action="applyFilter" data-component="filters" data-filter="agentId" class="vscode-select">
					<option value="">Agent</option>
					${agentOptions}
				</select>
				<select id="flt_model" data-action="applyFilter" data-component="filters" data-filter="modelId" class="vscode-select">
					<option value="">Model</option>
					${modelOptions}
				</select>
			</div>
		`;
	}

}
