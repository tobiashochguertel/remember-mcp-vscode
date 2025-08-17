import { ComponentView } from '../shared/ComponentBase';

export interface ModelItem {
	id: string;
	count: number;
	tokensEst?: number;
	latencyMsMedian: number;
}

export interface ModelsListState {
	items: ModelItem[];
}

export class ModelsListView implements ComponentView<ModelsListState, never> {
	render(state: ModelsListState): string {
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
}
