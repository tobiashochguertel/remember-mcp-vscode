import * as vscode from 'vscode';
import { ComponentBase, ComponentMessage } from '../shared/ComponentBase';
import { ActivityFeedComponentModel } from './ActivityFeedComponentModel';
import { ILogger } from '../../../../types/logger';

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

/**
 * Activity Feed Component View
 */
export class ActivityFeedView extends ComponentBase {
	private componentModel: ActivityFeedComponentModel;

	constructor(
		private webview: vscode.Webview,
		componentModel: ActivityFeedComponentModel,
		_logger: ILogger // Keep parameter for compatibility but use inherited logger
	) {
		super('activity-feed-container');
		this.componentModel = componentModel;
	}

	/**
	 * Handle messages relevant to activity feed
	 */
	protected async handleComponentMessage(_message: ComponentMessage): Promise<boolean> {
		// Activity feed is read-only, so they don't handle any specific messages
		// They update automatically when the model changes
		return false;
	}

	/**
	 * Render the activity feed HTML
	 */
	public render(): string {
		const state = this.componentModel.getState();

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
						${state.items.map((i: ActivityItemState) => `
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
