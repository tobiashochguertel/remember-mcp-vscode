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
			return '<section class="activity panel-section"><h4>Activity</h4><div class="empty">No recent activity</div></section>';
		}

		// Lightweight formatting: '2025-08-14T11:21:23.487Z' -> '2025-08-14 11:21:23'
		const fmt = (iso: string): string => {
			// Expect ISO 8601; extract date + time (seconds precision)
			// Avoid Date parsing (keeps original UTC text) and stay cheap.
			const m = iso.match(/^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2}:[0-9]{2}:[0-9]{2})/);
			if (m) {
				return `${m[1]} ${m[2]}`;
			}
			// Fallback: remove T, strip ms + Z if present
			return iso.replace('T',' ').replace(/\.[0-9]{3}Z$/, '').replace(/Z$/,'');
		};
		return `
			<section class="activity panel-section">
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
								<td class="datetime" data-iso="${i.timeISO}">${fmt(i.timeISO)}</td>
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
