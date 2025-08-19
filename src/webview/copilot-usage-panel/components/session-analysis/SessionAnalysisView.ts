export class SessionAnalysisView {
	render(state: { enabled: boolean; model: string; status: 'idle' | 'running' | 'disabled'; analysisSummary?: { latestSessionId: string; latestTimestamp: number; totalTurns: number; totalToolCallRounds: number; lastUserPromptPreview?: string; lastResponseChars: number } }): string {
		return `
		<section class="card">
			<h2>Session analysis (GitHub Models)</h2>
			<div class="summary">Status: ${state.status} • Model: ${state.model}</div>
			<div class="actions">
				<button id="btnRequestConsent">${state.enabled ? 'Disable background analysis' : 'Enable background analysis'}</button>
				<button id="btnRunOnce">Run once</button>
			</div>
			<div class="field" style="margin-top:8px">
				<label for="selModel" style="margin-right:6px">Model:</label>
				<select id="selModel">
					${this.renderModelOptions(state.model)}
				</select>
			</div>
			${this.renderResults(state)}
		</section>`;
	}

	private escapeHtml(text: string | null | undefined): string {
		if (text === null || text === undefined) {
			return '';
		}
		return text.replace(/[&<>"']/g, (ch: string) => {
			switch (ch) {
				case '&':
					return '&amp;';
				case '<':
					return '&lt;';
				case '>':
					return '&gt;';
				case '"':
					return '&quot;';
				case '\'':
					return '&#39;';
				default:
					return ch;
			}
		});
	}

	private renderModelOptions(selected: string): string {
		const options = [
			{ value: 'gpt-5-mini', label: 'gpt-5-mini' },
			{ value: 'gpt-4o', label: 'gpt-4o' },
			{ value: 'gpt-4o-mini', label: 'gpt-4o-mini' },
			{ value: 'gpt-4o-reasoning', label: 'gpt-4o-reasoning' },
		];
		return options
			.map(o => `<option value=\"${o.value}\"${o.value === selected ? ' selected' : ''}>${o.label}</option>`)
			.join('');
	}

	getClientInitScript(): string {
		return `
		(function(){
			const consentBtn = document.getElementById('btnRequestConsent');
			const runBtn = document.getElementById('btnRunOnce');
			const modelSelect = document.getElementById('selModel');
			if (consentBtn) consentBtn.addEventListener('click', () => sendMessage('toggleConsent'));
			if (runBtn) runBtn.addEventListener('click', () => sendMessage('runNow'));
			if (modelSelect) modelSelect.addEventListener('change', function (ev) {
				var target = ev && ev.target ? ev.target : modelSelect;
				var value = target && target.value !== undefined ? target.value : null;
				if (value) sendMessage('setModel', { model: value });
			});
		})();
		`;
	}

	private renderResults(state: { analysisSummary?: { latestSessionId: string; latestTimestamp: number; totalTurns: number; totalToolCallRounds: number; lastUserPromptPreview?: string; lastResponseChars: number } }): string {
		const s = state.analysisSummary;
		if (!s) {
			return '<div class="note">No analysis yet. Enable background analysis or click Run once.</div>';
		}
		const dt = new Date(s.latestTimestamp);
		const time = Number.isNaN(dt.getTime()) ? '' : dt.toLocaleString();

		return `
			<div class="group" style="margin-top:10px">
				<div class="section-title">Latest session</div>
				<div class="kv">
					<div class="row"><span class="k">Session ID</span><span class="v">${s.latestSessionId}</span></div>
					<div class="row"><span class="k">When</span><span class="v">${time}</span></div>
					<div class="row"><span class="k">Turns</span><span class="v">${s.totalTurns}</span></div>
					<div class="row"><span class="k">Tool call rounds</span><span class="v">${s.totalToolCallRounds}</span></div>
					<div class="row"><span class="k">Last user prompt</span><span class="v">${this.escapeHtml(s.lastUserPromptPreview || '')}</span></div>
					<div class="row"><span class="k">Last response size</span><span class="v">${s.lastResponseChars.toLocaleString()} chars</span></div>
				</div>
			</div>`;
	}
}
