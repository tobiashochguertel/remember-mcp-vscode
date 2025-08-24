import * as vscode from 'vscode';
import { ComponentBase, ComponentMessage } from '../shared/ComponentBase';
import { AgentsListComponentModel } from './AgentsListComponentModel';
import { ILogger } from '../../../../types/logger';

export interface AgentItem {
	id: string;
	count: number;
	latencyMsMedian: number;
	editRatio: number;
	series7d?: number[];
}

export interface AgentsListState {
	items: AgentItem[];
	isLoading?: boolean;
}

export class AgentsListView extends ComponentBase {
	private componentModel: AgentsListComponentModel;

	constructor(
		webview: vscode.Webview,
		componentModel: AgentsListComponentModel,
		private logger: ILogger
	) {
		super('agents-list-container');
		this.componentModel = componentModel;

		// Subscribe to model changes - component will be re-rendered when view calls render()
		this.componentModel.onDidChange(() => {
			// Component will be re-rendered when the view calls render()
		});
	}

	/**
	 * Handle messages relevant to agents list
	 */
	protected async handleComponentMessage(_message: ComponentMessage): Promise<boolean> {
		// Agents list is read-only, so they don't handle any specific messages
		// They update automatically when the model changes
		return false;
	}

	/**
	 * Render the agents list HTML
	 */
	public render(): string {
		const state = this.componentModel.getState();

		if (state.isLoading) {
			return '<section class="agents panel-section"><h4>Agents</h4><div class="empty">Loading...</div></section>';
		}
		if (!state.items.length) {
			return '<section class="agents panel-section"><h4>Agents</h4><div class="empty">No data</div></section>';
		}
		return `
			<section class="agents panel-section">
				<h4>Agents</h4>
				<table class="table">
					<thead>
						<tr>
							<th>Agent</th>
							<th class="num">Requests</th>
							<th class="num">Median</th>
							<th class="num">Edit ratio</th>
						</tr>
					</thead>
					<tbody>
						${state.items.map((i: AgentItem) => `
							<tr>
								<td class="id">${i.id}</td>
								<td class="num">${i.count}</td>
								<td class="num">${Math.round(i.latencyMsMedian)} ms</td>
								<td class="num">${i.editRatio.toFixed(2)}</td>
							</tr>`).join('')}
					</tbody>
				</table>
			</section>
		`;
	}
}
