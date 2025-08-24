import * as vscode from 'vscode';
import { ServiceContainer } from '../../types/service-container';
import { ILogger } from '../../types/logger';
import { CopilotUsageHistoryModel } from './copilot-usage-history-model';
import { CopilotUsageHistoryView } from './copilot-usage-history-view';
import { FiltersView } from './components/filters/FiltersView';
import { KpiChipsView } from './components/kpis/KpiChipsView';
import { AgentsListView } from './components/agents/AgentsListView';
import { ModelsListView } from './components/models/ModelsListView';
import { ActivityFeedView } from './components/activity/ActivityFeedView';
import { DailyRequestsChartView } from './components/request-chart/DailyRequestsChartView';
import { IComponent } from './components/shared/ComponentBase';
import { IComponentModel } from './components/shared/IComponentModel';

// New component models
import { FiltersComponentModel } from './components/filters/FiltersComponentModel';
import { KpiChipsComponentModel } from './components/kpis/KpiChipsComponentModel';
import { DailyRequestsChartComponentModel } from './components/request-chart/DailyRequestsChartComponentModel';
import { AgentsListComponentModel } from './components/agents/AgentsListComponentModel';
import { ModelsListComponentModel } from './components/models/ModelsListComponentModel';
import { ActivityFeedComponentModel } from './components/activity/ActivityFeedComponentModel';

/**
 * Copilot Usage History Panel using MVVM architecture with micro-view-models
 */
export class CopilotUsageHistoryPanel implements vscode.WebviewViewProvider, vscode.Disposable {
	public static readonly viewType = 'copilot-usage-history-panel';

	private _model: CopilotUsageHistoryModel | null = null;
	private _view: CopilotUsageHistoryView | null = null;
	private _webview: vscode.Webview | null = null;
	private _disposables: vscode.Disposable[] = [];

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly context: vscode.ExtensionContext,
		private readonly logger: ILogger
	) { }

	/**
	 * Resolve the webview view and set up model and view
	 */
	public async resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): Promise<void> {
		// Configure webview options
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.extensionUri, 'media')
			]
		};

		// Store webview reference for later use
		this._webview = webviewView.webview;

		try {
			// Resolve shared services from the container
			const container = ServiceContainer.getInstance();
			const analytics = container.getAnalyticsService();

			// Initialize model first
			this._model = new CopilotUsageHistoryModel(this.context, analytics, this.logger);
			
			// Create component models with specific dependencies
			const filtersComponentModel = new FiltersComponentModel(this._model, this.logger);
			const kpiChipsComponentModel = new KpiChipsComponentModel(analytics, this.logger);
			const dailyRequestsChartComponentModel = new DailyRequestsChartComponentModel(analytics, this.logger);
			const agentsListComponentModel = new AgentsListComponentModel(analytics, this.logger);
			const modelsListComponentModel = new ModelsListComponentModel(analytics, this.logger);
			const activityFeedComponentModel = new ActivityFeedComponentModel(analytics, this.logger);
			
			const componentModels: IComponentModel[] = [
				// All converted to new framework
				filtersComponentModel,
				kpiChipsComponentModel,
				dailyRequestsChartComponentModel,
				agentsListComponentModel,
				modelsListComponentModel,
				activityFeedComponentModel
			];

			// Inject component models into main model
			this._model.setComponentModels(componentModels);
			
			// Create all components that the view will manage
			const components: IComponent[] = [
				new FiltersView(webviewView.webview, filtersComponentModel, this.logger),
				new KpiChipsView(webviewView.webview, kpiChipsComponentModel, this.logger),
				new DailyRequestsChartView(webviewView.webview, dailyRequestsChartComponentModel, this.logger),
				new AgentsListView(webviewView.webview, agentsListComponentModel, this.logger),
				new ModelsListView(webviewView.webview, modelsListComponentModel, this.logger),
				new ActivityFeedView(webviewView.webview, activityFeedComponentModel, this.logger)
			];
			
			// Create view with injected components
			this._view = new CopilotUsageHistoryView(webviewView.webview, this._model, this.extensionUri, this.logger, components);

			// Handle messages from the webview
			const messageHandler = webviewView.webview.onDidReceiveMessage(async (message) => {
				await this.handleMessage(message);
			});
			this._disposables.push(messageHandler);

			// Handle panel visibility changes to refresh components when re-shown
			const visibilityHandler = webviewView.onDidChangeVisibility(() => {
				if (webviewView.visible && this._view) {
					// Panel is now visible - refresh all components to ensure they render
					this.logger.trace('Panel became visible, refreshing component views');
					this._view.refreshAllComponents().catch((error: any) => {
						this.logger.error('Failed to refresh components on visibility change:', error);
					});
				}
			});
			this._disposables.push(visibilityHandler);

			// Render view immediately (will show loading/empty state)
			await this._view.render();

			// Initialize unified data service in background (non-blocking)
			this.initializeUnifiedServiceAsync();

		} catch (error) {
			this.logger.error('Failed to initialize usage history panel:', error);
			webviewView.webview.html = this.generateErrorHtml(String(error));
		}
	}

	/**
	 * Initialize analytics engine asynchronously in the background
	 */
	private initializeUnifiedServiceAsync(): void {
		try {
			// Fire and forget - don't await
			if (this._model) {
				this._model.refreshAllData();
			}
		} catch (error) {
			this.logger.error('Failed to initialize unified data service:', error);
		}
	}

	/**
	 * Handle messages from the webview
	 */
	private async handleMessage(message: { type?: string; command?: string; [key: string]: any }): Promise<void> {
		if (!this._model || !this._view) {
			this.logger.warn('Model or view not available for message handling');
			return;
		}

		const msgType = message.type || message.command; // support either field
		this.logger.info(`Received message: ${msgType}`);

		try {
			// Handle component messages with new format
			if (msgType === 'componentMessage' && message.component && message.action) {
				await this._view.handleMessage({
					type: msgType,
					component: message.component,
					action: message.action,
					data: message.data
				});
				return;
			}

			// Handle component-rendered messages (legacy)
			if (msgType === 'component-rendered' && message.componentId && message.html) {
				this.sendComponentUpdate(message.componentId, message.html);
				return;
			}

			// First try to route to components (legacy)
			if (msgType) {
				const componentMessage = { ...message, type: msgType };
				await this._view.handleMessage(componentMessage);
			}

			// Handle panel-level messages that aren't handled by components
			switch (msgType) {
				case 'scanChatSessions':
					await this.scanChatSessions();
					break;
				default:
					this.logger.debug?.(`Message ${msgType} handled by components or ignored`);
			}
		} catch (error) {
			this.logger.error(`Error handling message ${msgType}:`, error);
			vscode.window.showErrorMessage(`Failed to ${msgType}: ${error}`);
		}
	}

	private sendComponentUpdate(componentId: string, html: string): void {
		if (this._webview) {
			this._webview.postMessage({
				type: 'component-update',
				componentId,
				html
			});
		}
	}

	/**
	 * Public API methods (called from commands)
	 */

	/**
	 * Refresh data (public method for command interface)
	 */
	public async refreshData(): Promise<void> {
		if (this._model) {
			await this._model.refreshAllData();
		}
	}

	/**
	 * Scan chat sessions (public method for command interface)
	 */
	public async scanChatSessions(): Promise<void> {
		if (!this._model) { return; }

		this.logger.info('scanChatSessions is not required; analytics uses raw session data and auto-refreshes.');
		vscode.window.showInformationMessage('Scan chat sessions is not required. Data updates automatically from raw session history.');
	}

	/**
	 * Export usage data (public method for command interface)
	 */
	public async exportData(_options: { includeRawEvents?: boolean; includeAnalytics?: boolean } = {}): Promise<void> {
		if (!this._model) {return;}

		try {
			const exportData = await this._model.getExportData();

			// Save to file
			const exportPath = await vscode.window.showSaveDialog({
				defaultUri: vscode.Uri.file(`copilot-usage-export-${new Date().toISOString().split('T')[0]}.json`),
				filters: {
					'JSON files': ['json'],
					'All files': ['*']
				}
			});

			if (exportPath) {
				await vscode.workspace.fs.writeFile(
					exportPath, 
					Buffer.from(JSON.stringify(exportData, null, 2), 'utf8')
				);
				vscode.window.showInformationMessage(`Usage data exported to ${exportPath.fsPath}`);
				this.logger.info(`Data exported to ${exportPath.fsPath}`);
			}

		} catch (error) {
			this.logger.error('Error exporting data:', error);
			vscode.window.showErrorMessage('Failed to export usage data.');
		}
	}

	/**
	 * Clear storage (public method for command interface)
	 */
	/**
	 * Clear storage (public method for command interface)
	 * This method is called from the toolbar command which already shows confirmation
	 */
	public async clearStorage(): Promise<void> {
	}

	/**
	 * Check if usage data exists (public method for command interface)
	 */
	public hasData(): boolean {
		return this._model?.hasData() || false;
	}

	/**
	 * Generate error HTML for display in webview
	 */
	private generateErrorHtml(message: string): string {
		return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>Error</title>
			<style>
				body { 
					font-family: var(--vscode-font-family); 
					color: var(--vscode-foreground);
					background-color: var(--vscode-sideBar-background);
					padding: 20px;
				}
				.error { 
					color: var(--vscode-errorForeground);
					background-color: var(--vscode-inputValidation-errorBackground);
					padding: 12px;
					border-radius: 4px;
					border: 1px solid var(--vscode-inputValidation-errorBorder);
					text-align: center;
				}
			</style>
		</head>
		<body>
			<div class="error">
				<h3>Error Loading Usage History</h3>
				<p>${message}</p>
				<button onclick="location.reload()">Retry</button>
			</div>
		</body>
		</html>`;
	}

	/**
	 * Dispose of the panel and clean up resources
	 */
	public dispose(): void {
		this._disposables.forEach(d => d.dispose());
		this._disposables = [];

		if (this._view) {
			this._view.dispose();
			this._view = null;
		}

		if (this._model) {
			this._model.dispose();
			this._model = null;
		}
	}
}
