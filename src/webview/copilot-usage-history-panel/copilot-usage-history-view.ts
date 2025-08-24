import * as vscode from 'vscode';
import { CopilotUsageHistoryModel } from './copilot-usage-history-model';
import { WebviewUtils } from '../shared/webview-utils';
import { ILogger } from '../../types/logger';
import { FiltersView } from './components/filters/FiltersView';
import { KpiChipsView } from './components/kpis/KpiChipsView';
import { AgentsListView } from './components/agents/AgentsListView';
import { ModelsListView } from './components/models/ModelsListView';
import { ActivityFeedView } from './components/activity/ActivityFeedView';
import { DailyRequestsChartView } from './components/charts/DailyRequestsChartView';
import { IComponent, ComponentMessage } from './components/shared/ComponentBase';
import { InsightsView } from './components/insights/InsightsView';

/**
 * View Coordinator for Copilot Usage History Panel
 * Manages component lifecycle and coordinates updates between model and view
 */
export class CopilotUsageHistoryView {
	private readonly components: IComponent[] = [];
	private _disposables: vscode.Disposable[] = [];

	constructor(
		private readonly _webview: vscode.Webview,
		private readonly _model: CopilotUsageHistoryModel,
		private readonly _extensionUri: vscode.Uri,
		private readonly _logger: ILogger
	) {
		// Initialize components with the webview and model
		this.components.push(
			new FiltersView(this._webview, this._model, this._logger),
			new KpiChipsView(this._webview, this._model, this._logger),
			new DailyRequestsChartView(this._webview, this._model, this._logger),
			new AgentsListView(this._webview, this._model, this._logger),
			new ModelsListView(this._webview, this._model, this._logger),
			new ActivityFeedView(this._webview, this._model, this._logger),
			new InsightsView(this._webview, this._model, this._logger),
		);

		// Set up data binding: model changes update the view (for non-PostMessage components)
		this._model.onDataChanged(async () => {
			try {
				this._logger.trace('History model data changed, checking if full re-render is needed');
				// Only re-render if we have legacy components or need to update the skeleton
				await this.render();
			} catch (error) {
				this._logger.error('Error rendering CopilotUsageHistoryView:', error);
			}
		});
	}

	/**
	 * Route a message to the appropriate component(s)
	 */
	public async handleMessage(message: ComponentMessage): Promise<void> {
		this._logger.debug?.('Routing message to components:', message.type);
		
		// Route to all components - each decides if it handles the message
		for (const component of this.components) {
			try {
				const handled = await component.handleMessage(message);
				if (handled) {
					this._logger.debug?.(`Message ${message.type} handled by component`);
				}
			} catch (error) {
				this._logger.error(`Error handling message ${message.type} in component:`, error);
			}
		}
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
		
		// CRITICAL: After setting HTML, trigger all components to update their containers
		// This fixes the race condition where components tried to update before containers existed
		await this.refreshComponentViews();
		
		const shouldShowToolbar = this._model.hasData();
		await this.updateToolbarVisibility(shouldShowToolbar);
	}

	/**
	 * Refresh all component views - forces them to re-render their current state
	 * This is used after the HTML is set to populate the placeholder containers
	 */
	private async refreshComponentViews(): Promise<void> {
		this._logger.trace('Refreshing all component views after HTML update');
		
		// Force each component to re-render by triggering their state change handlers
		// This ensures the PostMessage updates are sent to existing DOM containers
		for (const component of this.components) {
			try {
				// Trigger component update by calling their onStateChanged equivalent
				// For now, we'll send a refresh message to each component
				const refreshMessage = { type: 'component-refresh' };
				await component.handleMessage(refreshMessage);
			} catch (error) {
				this._logger.error(`Error refreshing component ${component.componentId}:`, error);
			}
		}
	}

	/**
	 * Public method to refresh all components - used when panel becomes visible again
	 */
	public async refreshAllComponents(): Promise<void> {
		await this.refreshComponentViews();
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
	 * Generate complete HTML content using component placeholders
	 */
	private async generateHtml(): Promise<string> {
		if (!this._model.hasData()) {
			return await this.generateSimpleNoDataHtml();
		}

		const chartJsUri = this.getChartJsUri();
		const styles = await this.getWebviewStyles();
		const sharedScript = WebviewUtils.getSharedScript();

		// Generate placeholders for all components
		const componentPlaceholders = this.generateComponentPlaceholders();

		return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval' vscode-resource:; font-src 'self' data:;">
			<title>Copilot Usage History</title>
			<script src="${chartJsUri}"></script>
			${sharedScript}
			${styles}
		</head>
		<body>

			${componentPlaceholders}
			
			${this.generateClientScript()}
		</body>
		</html>`;
	}

	/**
	 * Generate placeholder containers for all PostMessage components
	 */
	private generateComponentPlaceholders(): string {
		return this.components.map(component => {
			const sectionClass = this.getSectionClassForComponent(component.componentId);
			return `<section class="${sectionClass}" aria-label="${this.getAriaLabelForComponent(component.componentId)}">
				<div id="${component.componentId}" class="component-container">
					<!-- Component content will be populated via PostMessage -->
				</div>
			</section>`;
		}).join('\n');
	}

	/**
	 * Get appropriate section CSS class for a component
	 */
	private getSectionClassForComponent(_componentId: string): string {
		return 'panel-section';
	}

	/**
	 * Get appropriate aria-label for a component
	 */
	private getAriaLabelForComponent(componentId: string): string {
		switch (componentId) {
			case 'filters-container': return 'Filters';
			case 'kpi-chips-container': return 'Key metrics';
			case 'agents-list-container': return 'Agents list';
			case 'models-list-container': return 'Models list';
			case 'activity-feed-container': return 'Activity feed';
			case 'daily-requests-chart-container': return 'Daily requests chart';
			case 'insights-container': return 'Insights';
			default: return componentId.replace('-container', '').replace('-', ' ');
		}
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
	 * Generate daily requests chart section using legacy component (TODO: convert)
	 */
	private generateDailyRequestsChartSection(): string {
		const vm = this._model.dailyRequestsChartViewModel;
		const vmState = vm.getState();
		
		if (vmState.isLoading) {
			return '<section class="panel-section" aria-label="Daily requests chart"><div class="summary">Loading chart...</div></section>';
		}
		
		if (vmState.isEmpty) {
			return '<section class="panel-section" aria-label="Daily requests chart"><div class="summary">No chart data available</div></section>';
		}

		// Legacy chart rendering (simplified)
		return `
			<section class="panel-section" aria-label="Daily requests chart">
				<h3>Daily Requests</h3>
				<div class="chart-container">
					<canvas id="dailyRequestsChart" width="400" height="200"></canvas>
				</div>
			</section>
		`;
	}

	/**
	 * Generate agents section using legacy component (TODO: convert)
	 */
	private generateAgentsSection(): string {
		const vm = this._model.agentsListViewModel;
		const vmState = vm.getState();
		
		if (vmState.isLoading) {
			return '<section class="panel-section" aria-label="Agents"><div class="summary">Loading agents...</div></section>';
		}

		return `
			<section class="panel-section" aria-label="Agents">
				<h3>Agents</h3>
				<div class="agents-list">
					${vmState.items.map(item => `<div class="agent-item">${item.id}: ${item.count} requests</div>`).join('')}
				</div>
			</section>
		`;
	}

	/**
	 * Generate models section using legacy component (TODO: convert)
	 */
	private generateModelsSection(): string {
		const vmState = this._model.modelsListViewModel.getState();
		
		return `
			<section class="panel-section" aria-label="Models">
				<h3>Models</h3>
				<div class="models-list">
					${vmState.items.map(item => `<div class="model-item">${item.id}: ${item.count} requests</div>`).join('')}
				</div>
			</section>
		`;
	}

	/**
	 * Generate activity section using legacy component (TODO: convert)
	 */
	private generateActivitySection(): string {
		const vmState = this._model.activityFeedViewModel.getState();
		
		return `
			<section class="panel-section" aria-label="Activity">
				<h3>Recent Activity</h3>
				<div class="activity-list">
					${vmState.items.map(item => `<div class="activity-item">${item.timeISO}: ${item.type} (${item.agent})</div>`).join('')}
				</div>
			</section>
		`;
	}

	/**
	 * Generate client-side scripts for all components
	 */
	private generateClientScript(): string {
		// Collect client scripts from components
		const componentScripts = this.components
			.map(c => c.getClientScript?.() || '')
			.filter(s => s.trim().length > 0)
			.join('\n');

		return `
			<script>
			(function() {
				if (!window.vscode) { window.vscode = acquireVsCodeApi(); }

				function sendMessage(command, data) {
					// Send both type and command for compatibility
					const payload = { type: command, command }; 
					if (data && typeof data === 'object') {
						Object.assign(payload, data);
					}
					window.vscode.postMessage(payload);
				}

				// Expose globally
				window.sendMessage = sendMessage;

				// PostMessage handler for component updates
				window.addEventListener('message', event => {
					const message = event.data;
					if (message.type === 'component-update') {
						const element = document.getElementById(message.componentId);
						if (element) {
							element.innerHTML = message.html;
							
							// Execute any script tags that were just inserted
							const scripts = element.querySelectorAll('script');
							scripts.forEach(script => {
								const newScript = document.createElement('script');
								if (script.src) {
									newScript.src = script.src;
								} else {
									newScript.textContent = script.textContent;
								}
								// Replace the old script with new executable script
								script.parentNode.replaceChild(newScript, script);
							});
						}
					}
				});

				// Initialize component scripts
				${componentScripts}
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
			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval' vscode-resource:; font-src 'self' data:;">
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

	/**
	 * Dispose of the view and clean up resources
	 */
	public dispose(): void {
		this._disposables.forEach(d => d.dispose());
		this._disposables = [];

		// Dispose of all components
		this.components.forEach(component => component.dispose());
	}
}
