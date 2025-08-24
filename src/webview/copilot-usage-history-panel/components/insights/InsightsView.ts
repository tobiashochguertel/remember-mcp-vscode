import * as vscode from 'vscode';
import { ComponentBase, ComponentMessage } from '../shared/ComponentBase';
import { ILogger } from '../../../../types/logger';

export interface InsightItem {
	text: string;
}

export interface InsightsState {
	items: InsightItem[];
	collapsed?: boolean;
}

export class InsightsView extends ComponentBase {
	constructor(
		webview: vscode.Webview,
		private model: any,
		private logger: ILogger
	) {
		super('insights-container');

		// Don't send initial content immediately - wait for refreshComponentViews()
		// this.onStateChanged();
	}

	protected async handleComponentMessage(_message: ComponentMessage): Promise<boolean> {
		// Read-only component; no direct message handling
		return false;
	}

	public render(): string {
		// Simple static insights for now
		const items: InsightItem[] = [
			{ text: 'Insights will be populated when data is available.' }
		];
		if (!items.length) { return ''; }

		return `
			<section class="insights panel-section">
				<h4>Insights</h4>
				<ul class="insight-list">
					${items.slice(0, 3).map(i => `<li>${i.text}</li>`).join('')}
				</ul>
			</section>
		`;
	}
}
