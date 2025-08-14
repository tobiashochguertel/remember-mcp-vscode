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
			<div style="
				display: grid; 
				grid-template-columns: 1fr 1fr; 
				gap: 1px; 
				margin-bottom: 16px;
			">
				${items.map(i => `
					<div style="
						background-color: var(--vscode-panel-background);
						border: 1px solid var(--vscode-panel-border);
						padding: 8px;
						text-align: left;
					">
						<div style="
							font-size: 11px;
							color: var(--vscode-descriptionForeground);
							margin-bottom: 2px;
						">${i.label}</div>
						<div style="
							font-size: 16px;
							font-weight: bold;
							color: var(--vscode-foreground);
						">${i.value}</div>
					</div>
				`).join('')}
			</div>
		`;
	}
}
