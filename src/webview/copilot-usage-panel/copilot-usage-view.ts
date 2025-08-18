import * as vscode from 'vscode';
import { WebviewUtils } from '../shared/webview-utils';
import { ILogger } from '../../types/logger';
import { CopilotUsagePanelModel } from './copilot-usage-panel-model';
import { UsageStatsView } from './components/usage-stats/UsageStatsView';
import { SessionAnalysisView } from './components/session-analysis/SessionAnalysisView';

/**
 * View for Copilot Usage Panel (micro-MVVM)
 * Composes component views for usage stats and session analysis
 */
export class CopilotUsageView {
	private readonly usageStatsView: UsageStatsView;
	private readonly sessionAnalysisView: SessionAnalysisView;

	constructor(
		private readonly _webview: vscode.Webview,
		private readonly _model: CopilotUsagePanelModel,
		private readonly _extensionUri: vscode.Uri,
		private readonly _logger: ILogger
	) {
		this.usageStatsView = new UsageStatsView();
		this.sessionAnalysisView = new SessionAnalysisView();

		this._model.onDataChanged(async () => {
			try {
				await this.render();
			} catch (error) {
				this._logger.error('Error rendering CopilotUsageView:', error);
			}
		});
	}

	public async render(): Promise<void> {
		const html = await this.generateHtml();
		this._webview.html = html;
	}

	private async generateHtml(): Promise<string> {
		const styles = await WebviewUtils.getSharedStyles(this._extensionUri);
		const sharedScript = WebviewUtils.getSharedScript();

		const statsVm = this._model.usageStatsViewModel;
		const statsSection = this.usageStatsView.render({ stats: statsVm.stats, total: statsVm.totalRequests });
		const analysisVm = this._model.sessionAnalysisViewModel;
		const analysisSection = this.sessionAnalysisView.render(analysisVm.getState());

		return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Copilot Usage</title>
            ${styles}
            <style>
                tr { background-color: var(--vscode-sideBar-background); }
                @keyframes flash-blink {
                    0%   { background-color: var(--vscode-sideBar-background); color: var(--vscode-foreground); }
                    40%  { background-color: var(--vscode-foreground); color: var(--vscode-sideBar-background); }
                    100% { background-color: var(--vscode-sideBar-background); color: var(--vscode-foreground); }
                }
                .flash-row { animation: flash-blink 0.8s ease; }
                .card { margin-bottom: 12px; }
            </style>
        </head>
        <body>
            <div class="summary">Track and analyze Copilot model usage in real time as you work.</div>
            ${statsSection}
            ${analysisSection}
            ${sharedScript}
            <script>
                (function(){
                    if (!window.vscode) { window.vscode = acquireVsCodeApi(); }
                    function sendMessage(type, data = {}) { window.vscode.postMessage({ type, ...data }); }
                    window.sendMessage = sendMessage;
                })();
            </script>
            <script>
                ${this.usageStatsView.getClientInitScript()}
                ${this.sessionAnalysisView.getClientInitScript()}
            </script>
        </body>
        </html>`;
	}
}
