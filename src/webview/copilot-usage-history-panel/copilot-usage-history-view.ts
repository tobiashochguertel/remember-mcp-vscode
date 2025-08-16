import * as vscode from 'vscode';
import { CopilotUsageHistoryModel } from './copilot-usage-history-model';
import { WebviewUtils } from '../shared/webview-utils';
import { ILogger } from '../../types/logger';
import { FiltersView, FiltersState } from './components/filters/FiltersView';
import { KpiChipsView, KpiChipsRenderState } from './components/kpis/KpiChipsView';
import { AgentsListView } from './components/agents/AgentsListView';
import { ModelsListView } from './components/models/ModelsListView';
import { ActivityFeedView } from './components/activity/ActivityFeedView';

/**
 * View for Copilot Usage History Panel
 * Consumes micro-view-models and handles HTML generation and toolbar visibility
 */
export class CopilotUsageHistoryView {
	private readonly filtersView: FiltersView;
	private readonly kpiChipsView: KpiChipsView;
	private readonly agentsListView: AgentsListView;
	private readonly modelsListView: ModelsListView;
	private readonly activityFeedView: ActivityFeedView;

	constructor(
		private readonly _webview: vscode.Webview,
		private readonly _model: CopilotUsageHistoryModel,
		private readonly _extensionUri: vscode.Uri,
		private readonly _logger: ILogger
	) {
		// Initialize micro components
		this.filtersView = new FiltersView();
		this.kpiChipsView = new KpiChipsView();
		this.agentsListView = new AgentsListView();
		this.modelsListView = new ModelsListView();
		this.activityFeedView = new ActivityFeedView();

		// Set up data binding: model changes update the view
		this._model.onDataChanged(async () => {
			try {
				this._logger.trace('History model data changed, re-rendering view');
				await this.render();
			} catch (error) {
				this._logger.error('Error rendering CopilotUsageHistoryView:', error);
			}
		});
	}

	/**
	 * Generate and set the HTML content for the webview
	 */
	public async render(): Promise<void> {
		const error = this._model.getErrorMessage?.();
		if (error) {
			this._webview.html = await this.generateErrorHtml(error);
			await this.updateToolbarVisibility(false);
			return;
		}

		const html = await this.generateHtml();
		this._webview.html = html;
		
		const shouldShowToolbar = this._model.hasData();
		await this.updateToolbarVisibility(shouldShowToolbar);
	}

	/**
	 * Update toolbar visibility
	 */
	private async updateToolbarVisibility(shouldShowToolbar: boolean): Promise<void> {
		try {
			await vscode.commands.executeCommand('setContext', 'remember-mcp.hasUsageData', shouldShowToolbar);
			this._logger.trace(`View updated toolbar visibility: ${shouldShowToolbar}`);
		} catch (error) {
			this._logger.error('Error updating toolbar visibility:', error);
		}
	}

	/**
	 * Generate complete HTML content using micro components
	 */
	private async generateHtml(): Promise<string> {
		if (!this._model.hasData()) {
			return await this.generateSimpleNoDataHtml();
		}

		const chartJsUri = this.getChartJsUri();

		const styles = await this.getWebviewStyles();

		return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval' vscode-resource:; font-src 'self' data:;">
			<title>Copilot Usage History</title>
			<script src="${chartJsUri}"></script>
			${styles}
		</head>
		<body>
			<h1>Copilot Usage History</h1>
			
			${this.generateFiltersSection()}
			${this.generateKpiSection()}
			${this.generateAgentsSection()}
			${this.generateModelsSection()}
			${this.generateActivitySection()}
			
			${this.generateClientScript()}
		</body>
		</html>`;
	}

	/**
	 * Get Chart.js URI
	 */
	private getChartJsUri(): string {
		return this._webview.asWebviewUri(
			vscode.Uri.joinPath(this._extensionUri, 'media', 'chart.umd.js')
		).toString();
	}

	/**
	 * Generate filters section using FiltersView component
	 */
	private generateFiltersSection(): string {
		const filtersVmState = this._model.filtersViewModel.getState();
		const filtersState: FiltersState = {
			timeRange: filtersVmState.timeRange,
			workspace: 'all',
			agentOptions: filtersVmState.agentOptions,
			modelOptions: filtersVmState.modelOptions,
			agentId: undefined,
			modelId: undefined
		};
		return this.filtersView.render(filtersState);
	}

	/**
	 * Generate KPI section using KpiChipsView component
	 */
	private generateKpiSection(): string {
		const vm = this._model.kpiChipsViewModel;
		const vmState = vm.getState();
		const renderState: KpiChipsRenderState = {
			chips: vmState.chips.map(c => ({ label: c.label, value: c.value })),
			isLoading: vmState.isLoading
		};
		// Intentionally no heading for KPI chips (design choice)
		return this.kpiChipsView.render(renderState);
	}

	/**
	 * Generate agents section using AgentsListView component
	 */
	private generateAgentsSection(): string {
		const vm = this._model.agentsListViewModel;
		const vmState = vm.getState();
		return this.agentsListView.render({ items: vmState.items, isLoading: vmState.isLoading });
	}

	/**
	 * Generate models section using ModelsListView component
	 */
	private generateModelsSection(): string {
		const vmState = this._model.modelsListViewModel.getState();
		return this.modelsListView.render({ items: vmState.items });
	}

	/**
	 * Generate activity section using ActivityFeedView component
	 */
	private generateActivitySection(): string {
		const vmState = this._model.activityFeedViewModel.getState();
		return this.activityFeedView.render({ items: vmState.items });
	}

	/**
	 * Generate client-side scripts for all components
	 */
	private generateClientScript(): string {
		return `
			<script>
			(function() {
				const vscode = acquireVsCodeApi();

				function sendMessage(command, data) {
					// Send both type and command for compatibility
					const payload = { type: command, command }; 
					if (data && typeof data === 'object') {
						Object.assign(payload, data);
					}
					vscode.postMessage(payload);
				}

				// Expose globally
				window.sendMessage = sendMessage;

				// Initialize component event wiring
				${this.filtersView.getClientInitScript()}
			})();
			</script>
		`;
	}

	/**
	 * Generate simple no data view with prominent call-to-action
	 */
	private async generateSimpleNoDataHtml(): Promise<string> {
		const styles = await this.getWebviewStyles();
		return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval' vscode-resource: https://file+.vscode-resource.vscode-cdn.net; font-src 'self' data:;">
			<title>Copilot Usage History</title>
			${styles}
			<style>
				.empty-state {
					padding: 32px 24px;
					text-align: center;
					color: var(--vscode-foreground);
				}
				
				.empty-state h2 {
					font-size: 18px;
					font-weight: 600;
					margin: 0 0 8px 0;
					color: var(--vscode-foreground);
				}
				
				.empty-state .description {
					font-size: 13px;
					color: var(--vscode-descriptionForeground);
					margin-bottom: 24px;
					line-height: 1.4;
				}
				
				.cta-button {
					background-color: var(--vscode-button-background);
					color: var(--vscode-button-foreground);
					border: none;
					border-radius: 2px;
					padding: 10px 16px;
					font-size: 13px;
					font-weight: 500;
					cursor: pointer;
					font-family: var(--vscode-font-family);
					margin-bottom: 16px;
					width: 200px;
					transition: background-color 0.2s ease;
				}
				
				.cta-button:hover {
					background-color: var(--vscode-button-hoverBackground);
				}
				
				.cta-button:focus {
					outline: 1px solid var(--vscode-focusBorder);
					outline-offset: 2px;
				}
				
				.cta-button:disabled {
					background-color: var(--vscode-button-secondaryBackground);
					color: var(--vscode-button-secondaryForeground);
					cursor: not-allowed;
					opacity: 0.6;
				}
				
				.cta-button:disabled:hover {
					background-color: var(--vscode-button-secondaryBackground);
				}
				
				.secondary-action {
					font-size: 12px;
					color: var(--vscode-descriptionForeground);
					margin-top: 16px;
				}
				
				.secondary-action a {
					color: var(--vscode-textLink-foreground);
					text-decoration: none;
				}
				
				.secondary-action a:hover {
					text-decoration: underline;
				}
			</style>
		</head>
		<body>
			<div class="empty-state">
				<h2>No Copilot Usage Data... Yet!</h2>
				<div class="description">
					Track and analyze your entire Copilot usage history! See all your coding sessions, 
					chat interactions, and productivity patterns. Press the button to get started with 
					scanning your chat sessions for usage events.
				</div>
				
				<button class="cta-button" id="scanButton" ${this._model.isScanning() ? 'disabled' : ''}>
					${this._model.isScanning() ? 'Scanning...' : 'Scan Chat Sessions'}
				</button>
			</div>
			
			${WebviewUtils.getSharedScript()}
			<script>
				// Add event listener instead of inline onclick
				document.addEventListener('DOMContentLoaded', function() {
					const scanButton = document.getElementById('scanButton');
					if (scanButton) {
						scanButton.addEventListener('click', function() {
							if (scanButton.disabled) {
								console.log('Button is disabled, ignoring click');
								return;
							}
							console.log('Button clicked');
							sendMessage('scanChatSessions');
						});
					}
				});
			</script>
		</body>
		</html>`;
	}

	/**
	 * Generate error HTML
	 */
	private async generateErrorHtml(error: string): Promise<string> {
		const styles = await this.getWebviewStyles();
		
		return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>Error - Copilot Usage History</title>
			${styles}
		</head>
		<body>
			<div class="error">
				<h2>Error Loading Usage History</h2>
				<p>${WebviewUtils.escapeHtml(error)}</p>
				<button onclick="location.reload()">Retry</button>
			</div>
		</body>
		</html>`;
	}

	/**
	 * Get webview styles - uses shared CSS
	 */
	private async getWebviewStyles(): Promise<string> {
		return WebviewUtils.getSharedStyles(this._extensionUri);
	}
}
