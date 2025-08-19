import * as vscode from 'vscode';
import { ILogger } from '../../../../types/logger';

export type SessionAnalysisState = {
	enabled: boolean;
	model: string;
	status: 'idle' | 'running' | 'disabled';
};

/**
 * Placeholder VM for upcoming GitHub Models session analysis section
 */
export class SessionAnalysisViewModel implements vscode.Disposable {
	private _listeners: Array<() => void> = [];
	private _state: SessionAnalysisState = { enabled: false, model: 'gpt-4o-mini', status: 'disabled' };

	private static readonly STORAGE_KEYS = {
		enabled: 'sessionAnalysis.enabled',
		model: 'sessionAnalysis.model',
	} as const;

	private static readonly CONFIG = {
		prefix: 'remember-mcp.sessionAnalysis',
		enabled: 'remember-mcp.sessionAnalysis.enabled',
		model: 'remember-mcp.sessionAnalysis.model',
	} as const;

	constructor(private readonly context: vscode.ExtensionContext, private readonly logger: ILogger) {
		// Initialize from settings (source of truth)
		const cfg = vscode.workspace.getConfiguration();
		const enabled = cfg.get<boolean>(SessionAnalysisViewModel.CONFIG.enabled, false);
		const model = cfg.get<string>(SessionAnalysisViewModel.CONFIG.model, 'gpt-4o-mini');
		this._state.enabled = enabled;
		this._state.status = enabled ? 'idle' : 'disabled';
		this._state.model = model;

		// Keep in sync with settings changes
		this.context.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (!(
					e.affectsConfiguration(SessionAnalysisViewModel.CONFIG.enabled) ||
					e.affectsConfiguration(SessionAnalysisViewModel.CONFIG.model)
				)) { return; }
				const fresh = vscode.workspace.getConfiguration();
				const newEnabled = fresh.get<boolean>(SessionAnalysisViewModel.CONFIG.enabled, false);
				const newModel = fresh.get<string>(SessionAnalysisViewModel.CONFIG.model, 'gpt-4o-mini');
				let changed = false;
				if (newEnabled !== this._state.enabled) {
					this._state.enabled = newEnabled;
					this._state.status = newEnabled ? 'idle' : 'disabled';
					changed = true;
				}
				if (newModel !== this._state.model) {
					this._state.model = newModel;
					changed = true;
				}
				if (changed) { this.emit(); }
			})
		);
	}

	private getUpdateTarget(key: string): { cfg: vscode.WorkspaceConfiguration; target: vscode.ConfigurationTarget } {
		const folders = vscode.workspace.workspaceFolders;
		// Determine existing scope via inspect
		const baseCfg = vscode.workspace.getConfiguration();
		const inspection = baseCfg.inspect(key);
		if (folders && folders.length > 0) {
			// Prefer to preserve existing scope if set
			if (inspection?.workspaceValue !== undefined) {
				return { cfg: baseCfg, target: vscode.ConfigurationTarget.Workspace };
			}
			if (inspection?.workspaceFolderValue !== undefined) {
				// If single-root and folder-scoped value exists, update that folder
				if (folders.length === 1) {
					const folderCfg = vscode.workspace.getConfiguration(undefined, folders[0].uri);
					return { cfg: folderCfg, target: vscode.ConfigurationTarget.WorkspaceFolder };
				}
				// Multi-root: fall back to workspace scope for consistency
				return { cfg: baseCfg, target: vscode.ConfigurationTarget.Workspace };
			}
			// Default to workspace when a workspace is open
			return { cfg: baseCfg, target: vscode.ConfigurationTarget.Workspace };
		}
		// No workspace open: use global
		return { cfg: baseCfg, target: vscode.ConfigurationTarget.Global };
	}

	getState(): SessionAnalysisState { return { ...this._state }; }

	setEnabled(enabled: boolean): void {
		this._state.enabled = enabled;
		this._state.status = enabled ? 'idle' : 'disabled';
		// Update settings to reflect change (prefer workspace scope when available)
		const { cfg, target } = this.getUpdateTarget(SessionAnalysisViewModel.CONFIG.enabled);
		void cfg.update(SessionAnalysisViewModel.CONFIG.enabled, enabled, target);
		this.emit();
	}

	setModel(model: string): void {
		this._state.model = model;
		const { cfg, target } = this.getUpdateTarget(SessionAnalysisViewModel.CONFIG.model);
		void cfg.update(SessionAnalysisViewModel.CONFIG.model, model, target);
		this.emit();
	}

	// Convenience: toggle enabled flag
	toggleEnabled(): void {
		this.setEnabled(!this._state.enabled);
	}

	// Simulate one-off analysis run (placeholder)
	async runOnce(): Promise<void> {
		if (!this._state.enabled) {
			this.logger.info?.('SessionAnalysisVM: runOnce called while disabled');
			return;
		}
		this._state.status = 'running';
		this.emit();
		try {
			// Simulate brief async work
			await new Promise(resolve => setTimeout(resolve, 300));
		} finally {
			this._state.status = 'idle';
			this.emit();
		}
	}

	onChanged(listener: () => void): void { this._listeners.push(listener); }
	private emit(): void { for (const l of this._listeners) { try { l(); } catch (e) { this.logger.error('SessionAnalysisVM listener error', e); } } }

	dispose(): void { this._listeners = []; }
}
