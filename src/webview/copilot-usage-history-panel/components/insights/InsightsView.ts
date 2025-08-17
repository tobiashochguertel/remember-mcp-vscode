import { ComponentView } from '../shared/ComponentBase';

export interface InsightItem {
	text: string;
}

export interface InsightsState {
	items: InsightItem[];
	collapsed?: boolean;
}

export class InsightsView implements ComponentView<InsightsState, never> {
	render(state: InsightsState): string {
		if (!state.items.length) {
			return '';
		}
		return `
			<section class="insights panel-section">
				<h4>Insights</h4>
				<ul class="insight-list">
					${state.items.slice(0, 3).map(i => `<li>${i.text}</li>`).join('')}
				</ul>
			</section>
		`;
	}
}
