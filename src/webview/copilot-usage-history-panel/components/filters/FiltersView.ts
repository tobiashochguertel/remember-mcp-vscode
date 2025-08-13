import { ComponentView } from '../shared/ComponentBase';

export interface FiltersState {
	timeRange: 'today' | '7d' | '30d' | '90d';
	workspace: 'current' | 'all';
	agentId?: string;
	modelId?: string;
	agentOptions?: string[];
	modelOptions?: string[];
}

export interface FiltersActions {
	applyFilter(patch: Partial<FiltersState>): void;
	refresh(): void;
}

export class FiltersView implements ComponentView<FiltersState, FiltersActions> {
	private actions?: FiltersActions;

	bind(actions: FiltersActions): void {
		this.actions = actions; // Reserved for future server-side rendering callbacks
	}

	render(state: FiltersState): string {
		const timeOptions = [
			{ v: 'today', l: 'Today' },
			{ v: '7d', l: 'Last 7d' },
			{ v: '30d', l: 'Last 30d' },
			{ v: '90d', l: 'Last 90d' }
		];
		const wsOptions = [
			{ v: 'current', l: 'Current' },
			{ v: 'all', l: 'All Workspaces' }
		];

		const agentOptions = (state.agentOptions || []).map((id: string) => `<option value="${id}" ${id===state.agentId?'selected':''}>${id}</option>`).join('');
		const modelOptions = (state.modelOptions || []).map((id: string) => `<option value="${id}" ${id===state.modelId?'selected':''}>${id}</option>`).join('');

		return `
			<div class="filters" id="filters_bar">
				<select id="flt_time" class="vscode-select">
					${timeOptions.map(o => `<option value=\"${o.v}\" ${o.v===state.timeRange?'selected':''}>${o.l}</option>`).join('')}
				</select>
				<select id="flt_ws" class="vscode-select">
					${wsOptions.map(o => `<option value=\"${o.v}\" ${o.v===state.workspace?'selected':''}>${o.l}</option>`).join('')}
				</select>
				<select id="flt_agent" class="vscode-select">
					<option value="">Agent</option>
					${agentOptions}
				</select>
				<select id="flt_model" class="vscode-select">
					<option value="">Model</option>
					${modelOptions}
				</select>
				<button id="flt_refresh" class="vscode-button">Refresh</button>
			</div>
		`;
	}

	getClientInitScript(): string {
		return `
			(function(){
				const $ = (id) => document.getElementById(id);
				const patch = () => {
					const agentVal = $('flt_agent')?.value || '';
					const modelVal = $('flt_model')?.value || '';
					return {
						timeRange: /** @type any */($('flt_time')?.value || '7d'),
						workspace: /** @type any */($('flt_ws')?.value || 'all'),
						agentIds: agentVal ? [agentVal] : [],
						modelIds: modelVal ? [modelVal] : [],
					};
				};
				$('flt_time')?.addEventListener('change', () => sendMessage('applyFilter', patch()));
				$('flt_ws')?.addEventListener('change', () => sendMessage('applyFilter', patch()));
				$('flt_agent')?.addEventListener('change', () => sendMessage('applyFilter', patch()));
				$('flt_model')?.addEventListener('change', () => sendMessage('applyFilter', patch()));
				$('flt_refresh')?.addEventListener('click', () => sendMessage('refresh'));
			})();
		`;
	}
}
