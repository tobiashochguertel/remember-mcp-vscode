import * as vscode from 'vscode';
import { RememberMcpManager, PrerequisiteChecker } from '../../extension';
import { ILogger } from '../../types/logger';

export class ServerControlPanel implements vscode.WebviewViewProvider {
	public static readonly viewType = 'remember-mcp-panel';
	private prerequisites: { python: boolean; pipx: boolean; pythonVersion?: string; autoInstallAttempted?: boolean } | null = null;
	private isInstalling = false;
	private webviewView?: vscode.WebviewView;

	constructor(
		private readonly extensionUri: vscode.Uri, 
		private rememberManager: RememberMcpManager,
		private readonly logger: ILogger
	) {}

	public async resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this.webviewView = webviewView;
		
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.extensionUri]
		};

		// Check prerequisites on startup based on server command
		const config = vscode.workspace.getConfiguration('remember-mcp');
		const serverCommand = config.get<string>('server.command', 'pipx run --system-site-packages --spec git+https://github.com/NiclasOlofsson/mode-manager-mcp.git mode-manager-mcp');
		const needsPipx = PrerequisiteChecker.commandRequiresPipx(serverCommand);
		this.prerequisites = await PrerequisiteChecker.checkPrerequisites(needsPipx);
		webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(async data => {
			switch (data.type) {
				case 'start':
					await this.rememberManager.startServer();
					this.refreshView();
					break;
				case 'stop':
					this.rememberManager.stopServer();
					this.refreshView();
					break;
				case 'restart':
					await this.rememberManager.restartServer();
					this.refreshView();
					break;
				case 'recheckPrerequisites': {
					PrerequisiteChecker.clearCache();
					const config = vscode.workspace.getConfiguration('remember-mcp');
					const serverCommand = config.get<string>('server.command', 'pipx run --system-site-packages --spec git+https://github.com/NiclasOlofsson/mode-manager-mcp.git mode-manager-mcp');
					const needsPipx = PrerequisiteChecker.commandRequiresPipx(serverCommand);
					this.prerequisites = await PrerequisiteChecker.checkPrerequisites(needsPipx);
					webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
					break;
				}
				case 'installPipx':
					await this.handleInstallPipx(webviewView);
					break;
			}
		});
	}

	private refreshView(): void {
		if (this.webviewView) {
			this.webviewView.webview.html = this.getHtmlForWebview(this.webviewView.webview);
		}
	}

	private async handleInstallPipx(webviewView: vscode.WebviewView): Promise<void> {
		if (this.isInstalling) {
			return;
		}

		this.isInstalling = true;
        
		// Update UI to show installation in progress
		webviewView.webview.html = this.getInstallingHtml();
        
		try {
			this.logger.info('Starting automatic pipx installation...');
            
			const success = await PrerequisiteChecker.installPipx(this.logger);
            
			if (success) {
				this.logger.info('pipx installation completed successfully!');
				vscode.window.showInformationMessage('pipx installed successfully! Please restart VS Code to complete the setup.');
                
				// Mark that we attempted auto-install and clear cache
				PrerequisiteChecker.clearCache();
				this.prerequisites = await PrerequisiteChecker.checkPrerequisites();
				if (this.prerequisites) {
					this.prerequisites.autoInstallAttempted = true;
				}
			} else {
				this.logger.warn('pipx installation failed. Please install manually.');
				vscode.window.showErrorMessage('pipx installation failed. Please install manually using the instructions below.');
			}
		} catch (error) {
			this.logger.error(`pipx installation error: ${error}`);
			vscode.window.showErrorMessage('pipx installation failed. Please install manually using the instructions below.');
		} finally {
			this.isInstalling = false;
			webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	private getHtmlForWebview(webview: vscode.Webview) {
		// Check if pipx is needed based on server command
		const config = vscode.workspace.getConfiguration('remember-mcp');
		const serverCommand = config.get<string>('server.command', 'pipx run --system-site-packages --spec git+https://github.com/NiclasOlofsson/mode-manager-mcp.git mode-manager-mcp');
		const needsPipx = PrerequisiteChecker.commandRequiresPipx(serverCommand);

		// Show prerequisite warning only if required dependencies are missing
		const missingRequired = (needsPipx && (!this.prerequisites?.python || !this.prerequisites?.pipx));
		if (missingRequired) {
			return this.getPrerequisiteWarningHtml(needsPipx);
		}

		return this.getNormalControlHtml();
	}

	private getPrerequisiteWarningHtml(needsPipx: boolean = true) {
		const missingPython = !this.prerequisites?.python;
		const missingPipx = needsPipx && !this.prerequisites?.pipx;
		const pythonVersion = this.prerequisites?.pythonVersion || '';
        
		// Check if Python 3.10+ is available for auto-install
		const canAutoInstallPipx = needsPipx && this.prerequisites?.python && !this.prerequisites?.pipx && !this.prerequisites?.autoInstallAttempted;
		let pythonMajor = 0, pythonMinor = 0;
		if (pythonVersion) {
			const versionMatch = pythonVersion.match(/Python (\d+)\.(\d+)/);
			if (versionMatch) {
				pythonMajor = parseInt(versionMatch[1]);
				pythonMinor = parseInt(versionMatch[2]);
			}
		}
		const pythonVersionOk = pythonMajor > 3 || (pythonMajor === 3 && pythonMinor >= 10);

		return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
            <title>Prerequisites Required</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-sideBar-background);
                    margin: 0;
                    padding: 20px;
                    line-height: 1.4;
                }
                
                h3 {
                    margin: 0 0 16px 0;
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--vscode-sideBarTitle-foreground);
                }
                
                .warning {
                    background-color: var(--vscode-inputValidation-warningBackground);
                    border: 1px solid var(--vscode-inputValidation-warningBorder);
                    border-radius: 4px;
                    padding: 12px;
                    margin-bottom: 16px;
                }
                
                .info {
                    background-color: var(--vscode-inputValidation-infoBackground);
                    border: 1px solid var(--vscode-inputValidation-infoBorder);
                    border-radius: 4px;
                    padding: 12px;
                    margin-bottom: 16px;
                }
                
                .warning-title, .info-title {
                    font-weight: 600;
                    margin-bottom: 8px;
                    display: flex;
                    align-items: center;
                }
                
                .warning-title {
                    color: var(--vscode-inputValidation-warningForeground);
                }
                
                .info-title {
                    color: var(--vscode-inputValidation-infoForeground);
                }
                
                .warning-icon, .info-icon {
                    margin-right: 6px;
                }
                
                .missing-item {
                    margin: 8px 0;
                    color: var(--vscode-foreground);
                    font-size: 12px;
                }
                
                .missing-item strong {
                    color: var(--vscode-errorForeground);
                }
                
                .found-item {
                    margin: 8px 0;
                    color: var(--vscode-foreground);
                    font-size: 12px;
                }
                
                .found-item strong {
                    color: var(--vscode-inputValidation-infoForeground);
                }
                
                .install-section {
                    margin-top: 16px;
                }
                
                .install-title {
                    font-weight: 600;
                    margin-bottom: 8px;
                    color: var(--vscode-sideBarTitle-foreground);
                }
                
                .install-step {
                    margin: 8px 0;
                    font-size: 12px;
                    color: var(--vscode-foreground);
                }
                
                .install-step-number {
                    display: inline-block;
                    width: 20px;
                    height: 20px;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border-radius: 50%;
                    text-align: center;
                    line-height: 20px;
                    font-size: 11px;
                    font-weight: 600;
                    margin-right: 8px;
                }
                
                .code {
                    background-color: var(--vscode-textCodeBlock-background);
                    border: 1px solid var(--vscode-widget-border);
                    border-radius: 3px;
                    padding: 4px 8px;
                    font-family: var(--vscode-editor-font-family);
                    font-size: 11px;
                    margin: 4px 0;
                    color: var(--vscode-textPreformat-foreground);
                }
                
                .link {
                    color: var(--vscode-textLink-foreground);
                    text-decoration: none;
                    font-size: 12px;
                }
                
                .link:hover {
                    color: var(--vscode-textLink-activeForeground);
                    text-decoration: underline;
                }
                
                button {
                    width: 100%;
                    padding: 6px 12px;
                    margin: 4px 0;
                    border: none;
                    border-radius: 2px;
                    font-size: 12px;
                    cursor: pointer;
                    font-family: var(--vscode-font-family);
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                }
                
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                
                button.primary {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                }
                
                button.secondary {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                }
                
                button.secondary:hover {
                    background-color: var(--vscode-button-secondaryHoverBackground);
                }
                
                .auto-install-section {
                    margin-top: 16px;
                    padding: 12px;
                    background-color: var(--vscode-inputValidation-infoBackground);
                    border: 1px solid var(--vscode-inputValidation-infoBorder);
                    border-radius: 4px;
                }
            </style>
        </head>
        <body>
            <h3>Setup Required</h3>
            
            ${this.prerequisites?.python ? `
            <div class="info">
                <div class="info-title">
                    <span class="info-icon">✅</span>
                    Python Available
                </div>
                <div class="found-item"><strong>Python</strong> is installed: ${pythonVersion}</div>
            </div>
            ` : `
            <div class="warning">
                <div class="warning-title">
                    <span class="warning-icon">⚠️</span>
                    Missing Prerequisites
                </div>
                ${missingPython ? '<div class="missing-item"><strong>Python</strong> is not installed or not in PATH</div>' : ''}
            </div>
            `}
            
            ${!this.prerequisites?.python && missingPython ? `
            <div class="install-section">
                <div class="install-title">Install Python</div>
                <div class="install-step">
                    <span class="install-step-number">1</span>
                    Download Python from <a href="https://www.python.org/downloads/" class="link">python.org</a>
                </div>
                <div class="install-step">
                    <span class="install-step-number">2</span>
                    During installation, check "Add Python to PATH"
                </div>
                <div class="install-step">
                    <span class="install-step-number">3</span>
                    Restart VS Code after installation
                </div>
            </div>
            ` : ''}
            
            ${canAutoInstallPipx && pythonVersionOk ? `
            <div class="auto-install-section">
                <div class="install-title">🚀 Automatic Installation Available</div>
                <div class="install-step">
                    We can automatically install pipx for you using your existing ${pythonVersion}!
                </div>
                <button class="primary" onclick="sendMessage('installPipx')">Install pipx Automatically</button>
            </div>
            ` : ''}
            
            ${canAutoInstallPipx && !pythonVersionOk ? `
            <div class="warning">
                <div class="warning-title">
                    <span class="warning-icon">⚠️</span>
                    Python Version Too Old
                </div>
                <div class="missing-item">Automatic pipx installation requires Python 3.10+, but you have ${pythonVersion}</div>
            </div>
            ` : ''}
            
            ${(!canAutoInstallPipx && missingPipx && this.prerequisites?.python) || this.prerequisites?.autoInstallAttempted ? `
            <div class="install-section">
                <div class="install-title">Install pipx Manually</div>
                <div class="install-step">
                    <span class="install-step-number">1</span>
                    Open a terminal and run:
                    <div class="code">python -m pip install --user pipx</div>
                </div>
                <div class="install-step">
                    <span class="install-step-number">2</span>
                    Add pipx to PATH:
                    <div class="code">python -m pipx ensurepath</div>
                </div>
                <div class="install-step">
                    <span class="install-step-number">3</span>
                    Restart VS Code
                </div>
            </div>
            ` : ''}
            
            ${needsPipx ? `
            <div class="info" style="margin-top: 16px;">
                <div class="info-title">
                    <span class="info-icon">💡</span>
                    Alternative Options
                </div>
                <div class="install-step">
                    If you prefer not to use pipx, you can configure a different server command in settings:
                    <ul style="margin: 8px 0 0 20px; padding: 0;">
                        <li>Use <code>uv tool run</code> or <code>uvx</code></li>
                        <li>Use Docker: <code>docker run ...</code></li>
                        <li>Use the command directly if installed globally</li>
                    </ul>
                    Configure via: Settings → Remember MCP → Server Command
                </div>
            </div>
            ` : ''}
            
            <button class="secondary" onclick="sendMessage('recheckPrerequisites')">Check Again</button>
            
            <script>
                if (!window.vscode) { window.vscode = acquireVsCodeApi(); }
                function sendMessage(type) {
                    window.vscode.postMessage({ type });
                }
            </script>
        </body>
        </html>`;
	}

	private getInstallingHtml() {
		return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
            <title>Installing pipx</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-sideBar-background);
                    margin: 0;
                    padding: 20px;
                    line-height: 1.4;
                    text-align: center;
                }
                
                h3 {
                    margin: 0 0 16px 0;
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--vscode-sideBarTitle-foreground);
                }
                
                .installing {
                    background-color: var(--vscode-inputValidation-infoBackground);
                    border: 1px solid var(--vscode-inputValidation-infoBorder);
                    border-radius: 4px;
                    padding: 20px;
                    margin: 20px 0;
                }
                
                .spinner {
                    display: inline-block;
                    width: 20px;
                    height: 20px;
                    border: 2px solid var(--vscode-inputValidation-infoBorder);
                    border-radius: 50%;
                    border-top-color: var(--vscode-inputValidation-infoForeground);
                    animation: spin 1s ease-in-out infinite;
                    margin-right: 8px;
                }
                
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
                
                .install-message {
                    color: var(--vscode-inputValidation-infoForeground);
                    font-weight: 600;
                    margin-bottom: 8px;
                }
                
                .install-details {
                    color: var(--vscode-foreground);
                    font-size: 12px;
                }
            </style>
        </head>
        <body>
            <h3>Installing pipx</h3>
            
            <div class="installing">
                <div class="install-message">
                    <span class="spinner"></span>
                    Installing pipx automatically...
                </div>
                <div class="install-details">
                    This may take a minute. Check the output panel for progress.
                </div>
            </div>
        </body>
        </html>`;
	}

	private getNormalControlHtml() {
		const isRunning = this.rememberManager.isRunning();
		
		return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
            <title>Server Control</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-sideBar-background);
                    margin: 0;
                    padding-bottom: 13px;
                    padding-left: 20px;
                    padding-right: 20px;
                    padding-top: 0px;
                }
                
                h3 {
                    margin: 0 0 8px 0;
                    font-size: 13px;
                    font-weight: 600;
                    color: var(--vscode-sideBarTitle-foreground);
                }
                
                .info {
                    font-size: 12px;
                    color: var(--vscode-descriptionForeground);
                    margin-bottom: 8px;
                    line-height: 1.4;
                }
                
                .status {
                    font-size: 12px;
                    font-weight: 600;
                    margin-bottom: 8px;
                    padding: 4px 8px;
                    border-radius: 2px;
                }
                
                .status.running {
                    color: var(--vscode-terminal-ansiGreen);
                    background-color: var(--vscode-inputValidation-infoBackground);
                }
                
                .status.stopped {
                    color: var(--vscode-terminal-ansiYellow);
                    background-color: var(--vscode-inputValidation-warningBackground);
                }
                
                .button-row {
                    display: flex;
                    gap: 4px;
                    margin: 8px 0;
                }
                
                button {
                    flex: 1;
                    padding: 4px 8px;
                    border: none;
                    border-radius: 2px;
                    font-size: 11px;
                    cursor: pointer;
                    font-family: var(--vscode-font-family);
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                }
                
                button:hover:not(:disabled) {
                    background-color: var(--vscode-button-hoverBackground);
                }
                
                button:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
                
                .help {
                    font-size: 11px;
                    color: var(--vscode-descriptionForeground);
                    margin-top: 8px;
                    line-height: 1.3;
                }
            </style>
        </head>
        <body>
            <div class="info">
                Registers your mode-manager-mcp server with VS Code's built-in MCP system.
            </div>
            
            <div class="status ${isRunning ? 'running' : 'stopped'}">
                Status: ${isRunning ? '● Running' : '○ Stopped'}
            </div>
            
            <div class="button-row">
                <button onclick="sendMessage('start')" ${isRunning ? 'disabled' : ''}>Register</button>
                <button onclick="sendMessage('stop')" ${!isRunning ? 'disabled' : ''}>Unregister</button>
                <button onclick="sendMessage('restart')" ${!isRunning ? 'disabled' : ''}>Restart</button>
            </div>
            
            <div class="help">
                Once registered, Copilot automatically discovers and uses your memory server.
            </div>
            
            <script>
                if (!window.vscode) { window.vscode = acquireVsCodeApi(); }
                function sendMessage(type) {
                    window.vscode.postMessage({ type });
                }
            </script>
        </body>
        </html>`;
	}
}
