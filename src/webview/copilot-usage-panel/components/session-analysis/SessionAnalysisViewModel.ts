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

	constructor(private readonly context: vscode.ExtensionContext, private readonly logger: ILogger) {}

	getState(): SessionAnalysisState { return { ...this._state }; }

	setEnabled(enabled: boolean): void {
		this._state.enabled = enabled;
		this._state.status = enabled ? 'idle' : 'disabled';
		this.emit();
	}

	setModel(model: string): void { this._state.model = model; this.emit(); }

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
