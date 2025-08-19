import { UpdateProgressState } from './UpdateProgressView';
import { UnifiedSessionDataService } from '../../../../services/unified-session-data-service';
import { SessionScanResult } from '../../../../types/chat-session';
import { ILogger } from '../../../../types/logger';

/**
 * ViewModel for update progress component
 * Manages state and logic for chat session update progress tracking
 */
export class UpdateProgressViewModel {
	private _lastUpdateTime?: number;
	private readonly _updateIntervalMs: number;
	private readonly _sessionResultsCallback: (results: SessionScanResult[]) => void;

	constructor(
		private readonly unifiedDataService: UnifiedSessionDataService,
		private readonly logger: ILogger,
		updateIntervalMs: number = 60 * 1000 // Default 60 seconds
	) {
		this._updateIntervalMs = updateIntervalMs;

		// Subscribe to session updates
		this._sessionResultsCallback = (results: SessionScanResult[]) => {
			if (results.length > 0) {
				// Chat session file was updated, record this for progress tracking
				this.recordUpdate();
				this.logger.trace(`Progress tracking: Recorded session update from ${results.length} sessions`);
			}
		};

		this.unifiedDataService.onRawSessionResultsUpdated(this._sessionResultsCallback);
	}

	/**
	 * Record when a chat session update occurred
	 */
	recordUpdate(timestamp?: number): void {
		this._lastUpdateTime = timestamp || Date.now();
		this.emitChanged();
	}

	/**
	 * Get current state for rendering
	 */
	getState(): UpdateProgressState {
		return {
			lastUpdateTime: this._lastUpdateTime,
			updateIntervalMs: this._updateIntervalMs
		};
	}

	/**
	 * Check if an update is overdue
	 */
	isUpdateOverdue(): boolean {
		if (!this._lastUpdateTime) {
			return false;
		}
		const timeSinceUpdate = Date.now() - this._lastUpdateTime;
		return timeSinceUpdate > this._updateIntervalMs;
	}

	/**
	 * Get time until next update in milliseconds
	 */
	getTimeUntilNextUpdate(): number {
		if (!this._lastUpdateTime) {
			return 0;
		}
		const timeSinceUpdate = Date.now() - this._lastUpdateTime;
		return Math.max(0, this._updateIntervalMs - timeSinceUpdate);
	}

	/**
	 * Get progress percentage (0-100)
	 */
	getProgressPercent(): number {
		if (!this._lastUpdateTime) {
			return 0;
		}
		const timeSinceUpdate = Date.now() - this._lastUpdateTime;
		return Math.min(100, (timeSinceUpdate / this._updateIntervalMs) * 100);
	}

	/**
	 * Reset the progress (for when update is detected)
	 */
	reset(): void {
		this._lastUpdateTime = Date.now();
		this.emitChanged();
	}

	/**
	 * Subscribe to changes in the view model
	 */
	onChanged(callback: () => void): void {
		this._changeCallbacks.push(callback);
	}

	/**
	 * Dispose and clean up resources
	 */
	dispose(): void {
		this.unifiedDataService.removeRawSessionCallback(this._sessionResultsCallback);
		this._changeCallbacks = [];
	}

	private _changeCallbacks: Array<() => void> = [];

	private emitChanged(): void {
		for (const callback of this._changeCallbacks) {
			try {
				callback();
			} catch (error) {
				this.logger.error('UpdateProgressViewModel callback error:', error);
			}
		}
	}
}