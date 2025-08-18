export class SessionAnalysisView {
	render(state: { enabled: boolean; model: string; status: 'idle' | 'running' | 'disabled' }): string {
		return `
    <section class=\"card\">
      <h2>Session analysis (GitHub Models)</h2>
      <div class=\"summary\">Status: ${state.status} • Model: ${state.model}</div>
      <div class=\"actions\">
        <button id=\"btnRequestConsent\">${state.enabled ? 'Disable background analysis' : 'Enable background analysis'}</button>
        <button id=\"btnRunOnce\">Run once</button>
      </div>
      <div class=\"field\" style=\"margin-top:8px\">
        <label for=\"selModel\" style=\"margin-right:6px\">Model:</label>
        <select id=\"selModel\">
          ${this.renderModelOptions(state.model)}
        </select>
      </div>
      <div class=\"note\">This is a placeholder section. Coming soon: consent flow, model picker, and live results.</div>
    </section>`;
	}

	private renderModelOptions(selected: string): string {
		const options = [
			{ value: 'gpt-4o', label: 'gpt-4o' },
			{ value: 'gpt-4o-mini', label: 'gpt-4o-mini' },
			{ value: 'gpt-4o-reasoning', label: 'gpt-4o-reasoning' },
		];
		return options
			.map(o => `<option value="${o.value}"${o.value === selected ? ' selected' : ''}>${o.label}</option>`) 
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
      if (modelSelect) modelSelect.addEventListener('change', (ev) => {
        const value = (ev.target && (ev.target).value) || null;
        if (value) sendMessage('setModel', { model: value });
      });
    })();
    `;
	}
}
