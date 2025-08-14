/**
 * Copilot Usage History Panel using MVVM architecture with micro-view-models
 * Refactored to follow the same pattern as CopilotUsagePanel
 */

import * as vscode from 'vscode';
import { ServiceContainer } from '../../types/service-container';
import { ILogger } from '../../types/logger';
import { CopilotUsageHistoryModel } from './copilot-usage-history-model';
import { CopilotUsageHistoryView } from './copilot-usage-history-view';

export class CopilotUsageHistoryPanel implements vscode.WebviewViewProvider, vscode.Disposable {
	public static readonly viewType = 'copilot-usage-history-panel';

	private _model: CopilotUsageHistoryModel | null = null;
	private _view: CopilotUsageHistoryView | null = null;
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

		try {
			// Resolve shared services from the container
			const container = ServiceContainer.getInstance();
			const unifiedData = container.getUnifiedSessionDataService();
			const analytics = container.getAnalyticsService();

			// Initialize model and view immediately (before data service is fully ready)
			this._model = new CopilotUsageHistoryModel(this.context, unifiedData, analytics, this.logger);
			this._view = new CopilotUsageHistoryView(webviewView.webview, this._model, this.extensionUri, this.logger);

			// Handle messages from the webview
			const messageHandler = webviewView.webview.onDidReceiveMessage(async (message) => {
				await this.handleMessage(message);
			});
			this._disposables.push(messageHandler);

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
			const unified = ServiceContainer.getInstance().getUnifiedSessionDataService();
			// Fire and forget - don't await
			unified.initialize().then(async () => {
				this.logger.info('Unified session data service initialized successfully');
				// Now that the data service is ready, refresh the data
				if (this._model) {
					await this._model.refreshAllData();
				}
			}).catch((error: any) => {
				this.logger.error('Unified data service initialization failed:', error);
			});
		} catch (error) {
			this.logger.error('Failed to initialize unified data service:', error);
		}
	}

	/**
	 * Handle messages from the webview
	 */
	private async handleMessage(message: { type?: string; command?: string; [key: string]: any }): Promise<void> {
		if (!this._model) {
			this.logger.warn('Model not available for message handling');
			return;
		}

		const msgType = message.type || message.command; // support either field
		this.logger.info(`Received message: ${msgType}`);

		try {
			switch (msgType) {
				case 'refresh':
					await this.handleRefresh();
					break;
				case 'updateTimeRange':
					await this.updateFiltersFromMessage({ timeRange: message.timeRange });
					break;
				case 'applyFilter':
					await this.updateFiltersFromMessage(message);
					break;
				case 'scanChatSessions':
					await this.scanChatSessions();
					break;
				case 'testCcreqProvider':
					await this.handleTestCcreqProvider(message.ccreqUri);
					break;
				case 'showMore':
					await this.handleShowMore(message.table);
					break;
				default:
					this.logger.warn(`Unknown message type: ${msgType}`);
			}
		} catch (error) {
			this.logger.error(`Error handling message ${msgType}:`, error);
			vscode.window.showErrorMessage(`Failed to ${msgType}: ${error}`);
		}
	}

	/**
	 * Handle refresh request
	 */
	private async handleRefresh(): Promise<void> {
		if (!this._model) {return;}

		try {
			await this._model.refreshAllData();
			this.logger.info('Usage history data refreshed successfully');
		} catch (error) {
			this.logger.error('Error refreshing data:', error);
			vscode.window.showErrorMessage('Failed to refresh usage data.');
		}
	}

	/**
	 * Handle time range update
	 */
	private async handleUpdateTimeRange(timeRange: 'today' | '7d' | '30d' | '90d' | 'all'): Promise<void> {
		if (!this._model) {return;}

		try {
			if (timeRange === 'all') {
				// Use max configured window for now; future enhancement could load all stored events directly
				await this._model.updateTimeRange('90d');
			} else {
				await this._model.updateTimeRange(timeRange);
			}
			this.logger.info(`Time range updated to ${timeRange}`);
		} catch (error) {
			this.logger.error('Error updating time range:', error);
			vscode.window.showErrorMessage('Failed to update time range.');
		}
	}

	/**
	 * New unified filter update pathway (runtime global filters)
	 */
	private async updateFiltersFromMessage(msg: any): Promise<void> {
		if (!this._model) { return; }
		const patch: any = {};
		if (msg.timeRange) { patch.timeRange = msg.timeRange; }
		if (msg.workspace) { patch.workspace = msg.workspace; }
		if (msg.agentIds) { patch.agents = msg.agentIds; }
		if (msg.modelIds) { patch.models = msg.modelIds; }
		if (Object.keys(patch).length === 0) { return; }
		try {
			await this._model.updateFilters(patch);
			this.logger.debug?.('Applied filter patch', patch);
		} catch (e) {
			this.logger.error('Failed to apply filter patch', e);
			vscode.window.showErrorMessage('Failed to apply filters');
		}
	}

	/**
	 * Perform the actual clear data operation without confirmation
	 */
	private async performClearData(): Promise<void> {
		if (!this._model) {return;}

		try {
			const result = await this._model.clearData();
			this.logger.info(`Data cleared: ${result.deletedFiles} files, ${result.deletedEvents} events`);
		} catch (error) {
			this.logger.error('Error clearing data:', error);
			vscode.window.showErrorMessage('Failed to clear usage data.');
		}
	}

	/**
	 * Handle test ccreq provider request
	 */
	private async handleTestCcreqProvider(ccreqUri: string): Promise<void> {
		if (!this._model) {return;}

		try {
			const result = await this._model.testCcreqProvider(ccreqUri);
			
			if (!result.success) {
				vscode.window.showErrorMessage(`❌ ccreq provider test failed: ${result.message}`);
			}

		} catch (error) {
			this.logger.error('ccreq provider test failed:', error);
			vscode.window.showErrorMessage(`Failed to test ccreq provider: ${error}`);
		}
	}

	/**
	 * Handle show more request for tables
	 */
	private async handleShowMore(tableName: string): Promise<void> {
		// This would expand the table to show more items
		// For now, just log the request
		this.logger.info(`Show more requested for table: ${tableName}`);
		// TODO: Implement expand functionality in model
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
		if (!this._model) {return;}

		try {
			this.logger.info('Starting chat session scan...');
			
			const result = await this._model.scanChatSessions();
			
			if (result.events.length > 0) {
				this.logger.info(`Session scan complete: ${result.events.length} events from ${result.stats.totalSessions} sessions`);
				vscode.window.showInformationMessage(
					`Processed ${result.events.length} Copilot usage events from ${result.stats.totalSessions} chat sessions`
				);
			} else {
				this.logger.info('No chat sessions found');
				vscode.window.showInformationMessage('No Copilot chat sessions found');
			}

		} catch (error) {
			this.logger.error('Chat session scan failed:', error);
			vscode.window.showErrorMessage(`Failed to scan chat sessions: ${error}`);
		}
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
		await this.performClearData();
	}

	/**
	 * Check if usage data exists (public method for command interface)
	 */
	public hasData(): boolean {
		return this._model?.globalState.hasData || false;
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

		if (this._model) {
			this._model.dispose();
			this._model = null;
		}

		this._view = null;
	}
}
