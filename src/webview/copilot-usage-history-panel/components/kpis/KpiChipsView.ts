import { ComponentView } from '../shared/ComponentBase';

export interface KpiChipsRenderState {
	chips: Array<{ label: string; value: string }>;
	isLoading: boolean;
}

export class KpiChipsView implements ComponentView<KpiChipsRenderState, never> {
	render(state: KpiChipsRenderState): string {
		if (state.isLoading) {
			return '<section class="panel-section" aria-label="Key metrics"><div class="summary">Loading metrics...</div></section>';
		}
		const items = state.chips;
		return `
				<section class="panel-section" aria-label="Key metrics">
					<div class="kpi-grid" role="list">
						${items.map(i => `
							<div class="kpi-chip" role="listitem">
								<div class="label">${i.label}</div>
								<div class="value">${i.value}</div>
							</div>
						`).join('')}
					</div>
				</section>
			`;
	}
}
