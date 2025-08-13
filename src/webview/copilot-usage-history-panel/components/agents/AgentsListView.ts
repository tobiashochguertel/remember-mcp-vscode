import { ComponentView } from '../shared/ComponentBase';

export interface AgentItem {
	id: string;
	count: number;
	latencyMsMedian: number;
	editRatio: number;
	series7d?: number[];
}

export interface AgentsListState {
	items: AgentItem[];
}

export class AgentsListView implements ComponentView<AgentsListState, never> {
	render(state: AgentsListState): string {
		if (!state.items.length) {
			return '<section class="agents"><h4>Agents</h4><div class="empty">No data</div></section>';
		}
		return `
			<section class="agents">
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
						${state.items.map(i => `
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
