import { ComponentView } from '../shared/ComponentBase';

export interface KpiChipsState {
	requests: number;
	sessions: number;
	files: number;
	edits: number;
	latencyMsMedian: number;
	editRatio: number;
	models: number;
	agents: number;
}

export class KpiChipsView implements ComponentView<KpiChipsState, never> {
	render(state: KpiChipsState): string {
		const items = [
			{ label: 'Requests', value: state.requests },
			{ label: 'Sessions', value: state.sessions },
			{ label: 'Files', value: state.files },
			{ label: 'Edits', value: state.edits },
			{ label: 'Median Latency', value: `${Math.round(state.latencyMsMedian)} ms` },
			{ label: 'Edit Ratio', value: state.editRatio.toFixed(2) },
			{ label: 'Models', value: state.models },
			{ label: 'Agents', value: state.agents }
		];
		return `
			<div class="kpi-chips">
				${items.map(i => `<div class="kpi-chip"><span class="kpi-label">${i.label}</span><span class="kpi-value">${i.value}</span></div>`).join('')}
			</div>
		`;
	}
}
