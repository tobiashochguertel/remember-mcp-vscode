export class SessionAnalysisView {
	render(state: { enabled: boolean; model: string; status: 'idle' | 'running' | 'disabled'; analysisSummary?: { latestSessionId: string; latestTimestamp: number; totalTurns: number; totalToolCallRounds: number; lastUserPromptPreview?: string; lastResponseChars: number }; lastAnalysisResult?: { primaryPattern: string; confidence: number; reasons?: string[] } }): string {
		return `
		<section class="card">
			<h2>Session analysis (GitHub Models)</h2>
			<div class="summary">Status: ${state.status} • Model: ${state.model}</div>
			<div class="actions">
				<button id="btnRunOnce">Run once</button>
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

	private getConfidenceIndicator(confidence: number): { icon: string; color: string; severity: string } {
		if (confidence >= 0.8) {
			// High confidence - success/green (like passing tests)
			return { icon: 'codicon-check', color: 'var(--vscode-charts-green)', severity: 'high' };
		} else if (confidence >= 0.5) {
			// Medium confidence - warning/orange (like warnings)
			return { icon: 'codicon-warning', color: 'var(--vscode-charts-orange)', severity: 'medium' };
		} else {
			// Low confidence - error/red (like errors)
			return { icon: 'codicon-error', color: 'var(--vscode-charts-red)', severity: 'low' };
		}
	}

	getClientInitScript(): string {
		return `
		(function(){
			const runBtn = document.getElementById('btnRunOnce');
			if (runBtn) runBtn.addEventListener('click', () => sendMessage('runNow'));
		})();
		`;
	}

	private renderResults(state: { analysisSummary?: { latestSessionId: string; latestTimestamp: number; totalTurns: number; totalToolCallRounds: number; lastUserPromptPreview?: string; lastResponseChars: number }; lastAnalysisResult?: { primaryPattern: string; confidence: number; reasons?: string[] } }): string {
		const s = state.analysisSummary;
		if (!s) {
			return '<div class="note">No analysis yet. Click Run once to analyze latest session.</div>';
		}
		const dt = new Date(s.latestTimestamp);
		const time = Number.isNaN(dt.getTime()) ? '' : dt.toLocaleString();

		let analysisResultHtml = '';
		if (state.lastAnalysisResult) {
			const result = state.lastAnalysisResult;
			const indicator = this.getConfidenceIndicator(result.confidence);
			const confidencePercent = Math.round(result.confidence * 100);
			
			// Format reasons if available
			let reasonsHtml = '';
			if (result.reasons && result.reasons.length > 0) {
				const reasonsList = result.reasons.map(reason => `<li>${this.escapeHtml(reason)}</li>`).join('');
				reasonsHtml = `<ul class="analysis-reasons">${reasonsList}</ul>`;
			}

			analysisResultHtml = `
				<dt>Primary pattern</dt>
				<dd class="analysis-result">
					<span class="pattern-indicator">
						<span class="codicon ${indicator.icon}" style="color: ${indicator.color};" title="Confidence: ${confidencePercent}%"></span>
						<strong class="pattern-name">${this.escapeHtml(result.primaryPattern)}</strong>
						<span class="confidence-score" style="color: ${indicator.color};">(${confidencePercent}%)</span>
					</span>
					${reasonsHtml}
				</dd>`;
		}

		return `
			<div class="group" style="margin-top:10px">
				<h3>Latest session</h3>
				<dl class="session-stats">
					<dt>Session ID</dt>
					<dd>${this.escapeHtml(s.latestSessionId)}</dd>
					
					<dt>When</dt>
					<dd><time datetime="${new Date(s.latestTimestamp).toISOString()}">${time}</time></dd>
					
					<dt>Turns</dt>
					<dd>${s.totalTurns}</dd>
					
					<dt>Tool call rounds</dt>
					<dd>${s.totalToolCallRounds}</dd>
					
					<dt>Last user prompt</dt>
					<dd class="user-prompt">${this.escapeHtml(s.lastUserPromptPreview || '')}</dd>
					
					<dt>Last response size</dt>
					<dd>${s.lastResponseChars.toLocaleString()} chars</dd>
					${analysisResultHtml}
				</dl>
			</div>`;
	}
}
