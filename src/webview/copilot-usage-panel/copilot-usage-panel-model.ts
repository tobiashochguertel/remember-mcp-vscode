import * as vscode from 'vscode';
import { UnifiedSessionDataService } from '../../services/unified-session-data-service';
import { ILogger } from '../../types/logger';
import { UsageStatsViewModel } from './components/usage-stats/UsageStatsViewModel';
import { SessionAnalysisViewModel } from './components/session-analysis/SessionAnalysisViewModel';

/**
 * Aggregator model for Copilot Usage Panel (micro-MVVM)
 * Composes micro view-models for usage stats and session analysis
 */
export class CopilotUsagePanelModel implements vscode.Disposable {
	private _listeners: Array<() => void> = [];

	public readonly usageStatsViewModel: UsageStatsViewModel;
	public readonly sessionAnalysisViewModel: SessionAnalysisViewModel;

	constructor(
		private readonly extensionContext: vscode.ExtensionContext,
		private readonly unifiedDataService: UnifiedSessionDataService,
		private readonly logger: ILogger
	) {
		this.usageStatsViewModel = new UsageStatsViewModel(this.unifiedDataService, this.extensionContext, this.logger);
		this.sessionAnalysisViewModel = new SessionAnalysisViewModel(this.extensionContext, this.logger);

		// Bubble child VM changes
		this.usageStatsViewModel.onChanged(() => this.emit());
		this.sessionAnalysisViewModel.onChanged(() => this.emit());
	}

	public onDataChanged(listener: () => void): void {
		this._listeners.push(listener);
	}

	private emit(): void {
		for (const l of this._listeners) {
			try { l(); } catch (e) { this.logger.error('CopilotUsagePanelModel listener error', e); }
		}
	}

	public hasData(): boolean {
		return this.usageStatsViewModel.hasData();
	}

	public async clearStats(): Promise<void> {
		await this.usageStatsViewModel.clear();
	}

	public async refreshStats(): Promise<void> {
		await this.usageStatsViewModel.refresh();
	}

	// Session analysis actions
	public toggleConsent(): boolean {
		this.sessionAnalysisViewModel.toggleEnabled();
		return this.sessionAnalysisViewModel.getState().enabled;
	}

	public async runAnalysisOnce(): Promise<void> {
		await this.sessionAnalysisViewModel.runOnce();
	}

	public dispose(): void {
		this.usageStatsViewModel.dispose();
		this.sessionAnalysisViewModel.dispose();
		this._listeners = [];
	}
}
