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
      <div class=\"note\">This is a placeholder section. Coming soon: consent flow, model picker, and live results.</div>
    </section>`;
	}

	getClientInitScript(): string {
		return `
    (function(){
      const consentBtn = document.getElementById('btnRequestConsent');
      const runBtn = document.getElementById('btnRunOnce');
      if (consentBtn) consentBtn.addEventListener('click', () => sendMessage('toggleConsent'));
      if (runBtn) runBtn.addEventListener('click', () => sendMessage('runNow'));
    })();
    `;
	}
}
