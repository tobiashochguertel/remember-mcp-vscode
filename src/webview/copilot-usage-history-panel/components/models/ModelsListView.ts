import * as vscode from 'vscode';
import { ComponentBase, ComponentMessage } from '../shared/ComponentBase';
import { ModelsListViewModel } from './ModelsListViewModel';
import { ILogger } from '../../../../types/logger';

export interface ModelItem {
	id: string;
	count: number;
	tokensEst?: number;
	latencyMsMedian: number;
}

export interface ModelsListState {
	items: ModelItem[];
}

export class ModelsListView extends ComponentBase {
	private viewModel: ModelsListViewModel;

	constructor(
		webview: vscode.Webview,
		private model: any, // Model reference for accessing viewModel
		private logger: ILogger
	) {
		super(webview, 'models-list-container');
		this.viewModel = this.model.modelsListViewModel;

		// Subscribe to model changes and update when data changes
		this.viewModel.onDidChange(() => {
			this.onStateChanged();
		});

		// Don't send initial content immediately - wait for refreshComponentViews()
		// this.onStateChanged();
	}

	/**
	 * Handle messages relevant to models list
	 */
	protected async handleComponentMessage(_message: ComponentMessage): Promise<boolean> {
		// Models list is read-only, so they don't handle any specific messages
		// They update automatically when the model changes
		return false;
	}

	/**
	 * Render the models list HTML
	 */
	protected render(): string {
		const state = this.viewModel.getState();

		if (!state.items.length) {
			return '<section class="models panel-section"><h4>Models</h4><div class="empty">No data</div></section>';
		}
		return `
			<section class="models panel-section">
				<h4>Models</h4>
				<table class="table">
					<thead>
						<tr>
							<th>Model</th>
							<th class="num">Requests</th>
							<th class="num">Tokens</th>
							<th class="num">Median</th>
						</tr>
					</thead>
					<tbody>
						${state.items.map(i => `
							<tr>
								<td class="id">${i.id}</td>
								<td class="num">${i.count}</td>
								<td class="num">${i.tokensEst ?? 0}</td>
								<td class="num">${Math.round(i.latencyMsMedian)} ms</td>
							</tr>`).join('')}
					</tbody>
				</table>
			</section>
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
