import { ComponentView } from '../shared/ComponentBase';

export interface ActivityItemState {
	timeISO: string;
	type: string;
	agent: string;
	model: string;
	file?: string;
	latencyMs?: number;
	sessionId: string;
	requestId: string;
}

export interface ActivityFeedState {
	items: ActivityItemState[];
}

export class ActivityFeedView implements ComponentView<ActivityFeedState, never> {
	render(state: ActivityFeedState): string {
		if (!state.items.length) {
			return '<section class="activity"><h4>Activity</h4><div class="empty">No recent activity</div></section>';
		}
		return `
			<section class="activity">
				<h4>Activity</h4>
				<table class="table">
					<thead>
						<tr>
							<th>Time</th>
							<th>Type</th>
							<th>Agent</th>
							<th>Model</th>
							<th class="num">Latency</th>
							<th>File</th>
						</tr>
					</thead>
					<tbody>
						${state.items.map(i => `
							<tr title="${i.type} • ${i.agent} • ${i.model}">
								<td class="datetime" data-iso="${i.timeISO}">${i.timeISO}</td>
								<td>${i.type}</td>
								<td>${i.agent}</td>
								<td>${i.model}</td>
								<td class="num">${i.latencyMs ? Math.round(i.latencyMs) + ' ms' : ''}</td>
								<td>${i.file ?? ''}</td>
							</tr>`).join('')}
					</tbody>
				</table>
			</section>
		`;
	}
}
