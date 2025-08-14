import { ComponentView } from '../shared/ComponentBase';

export interface KpiChipsRenderState {
	chips: Array<{ label: string; value: string }>;
	isLoading: boolean;
}

export class KpiChipsView implements ComponentView<KpiChipsRenderState, never> {
	render(state: KpiChipsRenderState): string {
		if (state.isLoading) {
			return '<div style="margin-bottom:16px; color: var(--vscode-descriptionForeground);">Loading metrics...</div>';
		}
		const items = state.chips;
		return `
			<div style="
				display: grid; 
				grid-template-columns: repeat(auto-fill,minmax(80px,1fr)); 
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
