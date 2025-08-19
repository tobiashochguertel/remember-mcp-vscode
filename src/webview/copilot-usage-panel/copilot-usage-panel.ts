import * as vscode from 'vscode';
import { ServiceContainer } from '../../types/service-container';
import { ILogger } from '../../types/logger';
import { CopilotUsageView } from './copilot-usage-view';
import { CopilotUsagePanelModel } from './copilot-usage-panel-model';

/**
 * Main panel class that implements WebviewViewProvider
 * Coordinates model and view directly without separate controller
 */
export class CopilotUsagePanel implements vscode.WebviewViewProvider, vscode.Disposable {
	public static readonly viewType = 'remember-mcp-usage-panel';

	private _model: CopilotUsagePanelModel | null = null;
	private _view: CopilotUsageView | null = null;
	private _disposables: vscode.Disposable[] = [];
	private logger!: ILogger; // Logger must always be available from ServiceContainer

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly context: vscode.ExtensionContext
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

		// Get unified data service from service container
		if (!ServiceContainer.isInitialized()) {
			console.error('ServiceContainer not initialized');
			webviewView.webview.html = this.generateErrorHtml('Service container not initialized');
			return;
		}

		const serviceContainer = ServiceContainer.getInstance();
		const unifiedDataService = serviceContainer.getUnifiedSessionDataService();
		this.logger = serviceContainer.getLogger(); // Must not be null - crash if it is
		
		if (!unifiedDataService) {
			this.logger.error('UnifiedDataService not available in ServiceContainer');
			console.error('UnifiedDataService not available in ServiceContainer');
			// Show error in webview
			webviewView.webview.html = this.generateErrorHtml('Data service not available');
			return;
		}

		// Initialize model and view
		this._model = new CopilotUsagePanelModel(this.context, unifiedDataService, this.logger);
		this._view = new CopilotUsageView(webviewView.webview, this._model, this.extensionUri, this.logger);

		// Handle messages from the webview
		const messageHandler = webviewView.webview.onDidReceiveMessage(async (message) => {
			await this.handleMessage(message);
		});
		this._disposables.push(messageHandler);

		// Initial render
		await this._view.render();
	}

	/**
	 * Handle messages from the webview
	 */
	private async handleMessage(message: { type: string;[key: string]: any }): Promise<void> {
		if (!this._model) {
			return;
		}

		switch (message.type) {
			case 'clearStats':
				await this.handleClearStats();
				break;
			case 'refresh':
				await this.handleRefresh();
				break;
			case 'setModel':
				try {
					const model = typeof message.model === 'string' ? message.model : '';
					if (!model) { throw new Error('No model specified'); }
					this._model.setAnalysisModel(model);
					this.logger.info(`Session analysis model set to ${model}`);
					vscode.window.showInformationMessage(`Session analysis model set to ${model}.`);
				} catch (error) {
					this.logger.error('Error setting session analysis model:', error);
					console.error('Error setting session analysis model:', error);
					vscode.window.showErrorMessage('Failed to set session analysis model.');
				}
				break;
			case 'toggleConsent':
				try {
					const enabled = this._model.toggleConsent();
					this.logger.info(`Session analysis ${enabled ? 'enabled' : 'disabled'}`);
					vscode.window.showInformationMessage(`Session analysis ${enabled ? 'enabled' : 'disabled'}.`);
				} catch (error) {
					this.logger.error('Error toggling session analysis consent:', error);
					console.error('Error toggling session analysis consent:', error);
					vscode.window.showErrorMessage('Failed to toggle session analysis.');
				}
				break;
			case 'runNow':
				try {
					await this._model.runAnalysisOnce();
					this.logger.info('Session analysis run completed.');
				} catch (error) {
					console.error('Error running session analysis once:', error);
					vscode.window.showErrorMessage('Failed to run session analysis.');
				}
				break;
			default:
				console.warn(`Unknown message type: ${message.type}`);
		}
	}

	/**
	 * Handle clear statistics request
	 */
	private async handleClearStats(): Promise<void> {
		if (!this._model) {
			return;
		}

		try {
			await this._model.clearStats();
			this.logger.info('Model usage statistics cleared');
			vscode.window.showInformationMessage('Model usage statistics cleared.');
		} catch (error) {
			this.logger.error('Error clearing statistics:', error);
			console.error('Error clearing statistics:', error);
			vscode.window.showErrorMessage('Failed to clear usage statistics.');
		}
	}

	/**
	 * Handle refresh request
	 */
	private async handleRefresh(): Promise<void> {
		if (!this._model) {
			return;
		}

		try {
			await this._model.refreshStats();
			this.logger.info('Usage statistics refreshed');
		} catch (error) {
			this.logger.error('Error refreshing statistics:', error);
			console.error('Error refreshing statistics:', error);
			vscode.window.showErrorMessage('Failed to refresh usage statistics.');
		}
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
                    padding: 20px;
                }
                .error { 
                    color: var(--vscode-errorForeground);
                    text-align: center;
                }
            </style>
        </head>
        <body>
            <div class="error">
                <h3>Error</h3>
                <p>${message}</p>
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
