import { ComponentBase, ComponentMessage } from '../shared/ComponentBase';
import { KpiChipsComponentModel } from './KpiChipsComponentModel';
import { ILogger } from '../../../../types/logger';
import * as vscode from 'vscode';

export interface KpiChipsRenderState {
	chips: Array<{ label: string; value: string; tooltip?: string }>;
	isLoading: boolean;
}

/**
 * KPI Chips Component - manages its own state and rendering via PostMessage
 */
export class KpiChipsView extends ComponentBase {
	private componentModel: KpiChipsComponentModel;

	constructor(
		private webview: vscode.Webview,
		componentModel: KpiChipsComponentModel,
		private logger: ILogger
	) {
		super('kpi-chips-container');
		this.componentModel = componentModel;
	}

	/**
	 * Handle messages relevant to KPI chips
	 */
	protected async handleComponentMessage(_message: ComponentMessage): Promise<boolean> {
		// KPI chips are read-only, so they don't handle any specific messages
		// They update automatically when the model changes
		return false;
	}

	/**
	 * Render the KPI chips HTML
	 */
	public render(): string {
		const cmState = this.componentModel.getState();
		const state: KpiChipsRenderState = {
			chips: cmState.chips.map((c: any) => ({ label: c.label, value: c.value, tooltip: c.tooltip })),
			isLoading: cmState.isLoading
		};

		if (state.isLoading) {
			return '<div class="summary">Loading metrics...</div>';
		}

		const items = state.chips;
		return `
			<div class="kpi-grid" role="list">
				${items.map(i => `
					<div class="kpi-chip" role="listitem"${i.tooltip ? ` title="${escapeHtml(i.tooltip)}"` : ''}>
						<div class="label">${i.label}</div>
						<div class="value">${i.value}</div>
					</div>
				`).join('')}
			</div>
		`;
	}
}

// Minimal HTML escape to keep title safe
function escapeHtml(input: string): string {
	return input
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
