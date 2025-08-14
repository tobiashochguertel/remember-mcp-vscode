import * as vscode from 'vscode';
import { CopilotUsageHistoryModel } from './copilot-usage-history-model';
import { WebviewUtils } from '../shared/webview-utils';
import { ILogger } from '../../types/logger';
import { FiltersView, FiltersState } from './components/filters/FiltersView';
import { KpiChipsView, KpiChipsState } from './components/kpis/KpiChipsView';
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
		if (this._model.globalState.errorMessage) {
			this._webview.html = await this.generateErrorHtml(this._model.globalState.errorMessage);
			await this.updateToolbarVisibility(false);
			return;
		}

		const html = await this.generateHtml();
		this._webview.html = html;
		
		const shouldShowToolbar = this._model.globalState.hasData;
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
		if (!this._model.globalState.hasData) {
			return this.generateSimpleNoDataHtml();
		}

		const styles = await this.getWebviewStyles();

		return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' ${this._webview.cspSource}; style-src 'unsafe-inline' ${this._webview.cspSource}; img-src ${this._webview.cspSource} data:; font-src 'self' data:;">
			<title>Copilot Usage History</title>
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
	 * Generate filters section using FiltersView component
	 */
	private generateFiltersSection(): string {
		const filtersState: FiltersState = {
			timeRange: this._model.filterControls.timeRange.current,
			workspace: 'all'
		};

		return this.filtersView.render(filtersState);
	}

	/**
	 * Generate KPI section using KpiChipsView component
	 */
	private generateKpiSection(): string {
		// Get KPI data from analytics service
		const kpiState: KpiChipsState = {
			requests: 7, // Default for now - we'll hook this up properly
			sessions: 1,
			files: 1,
			edits: 7,
			latencyMsMedian: 0,
			editRatio: 1.0,
			models: 1,
			agents: 1
		};

		return `
			<h2>Key Metrics</h2>
			${this.kpiChipsView.render(kpiState)}
		`;
	}

	/**
	 * Generate agents section using AgentsListView component
	 */
	private generateAgentsSection(): string {
		// TODO: Get actual agents data from model
		return `
			<h2>Top Agents</h2>
			<div style="color: var(--vscode-descriptionForeground); font-style: italic;">Agents list component will be rendered here</div>
		`;
	}

	/**
	 * Generate models section using ModelsListView component
	 */
	private generateModelsSection(): string {
		// TODO: Get actual models data from model
		return `
			<h2>Top Models</h2>
			<div style="color: var(--vscode-descriptionForeground); font-style: italic;">Models list component will be rendered here</div>
		`;
	}

	/**
	 * Generate activity section using ActivityFeedView component
	 */
	private generateActivitySection(): string {
		// TODO: Get actual activity data from model
		return `
			<h2>Recent Activity</h2>
			<div style="color: var(--vscode-descriptionForeground); font-style: italic;">Activity feed component will be rendered here</div>
		`;
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
					vscode.postMessage({ command, data });
				}
				
				// Make sendMessage available globally for components
				window.sendMessage = sendMessage;
				
				// Initialize all micro component events
				${this.filtersView.getClientInitScript()}
				
			})();
			</script>
		`;
	}

	/**
	 * Generate simple no-data HTML
	 */
	private async generateSimpleNoDataHtml(): Promise<string> {
		const styles = await this.getWebviewStyles();
		
		return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>Copilot Usage History</title>
			${styles}
		</head>
		<body>
			<div class="no-data">
				<h2>No Usage Data Available</h2>
				<p>Start using GitHub Copilot to see your usage analytics here.</p>
			</div>
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
