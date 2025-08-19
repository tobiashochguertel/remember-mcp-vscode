import * as vscode from 'vscode';
import { UnifiedSessionDataService } from '../../../../services/unified-session-data-service';
import { SessionScanResult } from '../../../../types/chat-session';
import { ILogger } from '../../../../types/logger';

export type UsageStatItem = { model: string; count: number; updated: boolean };

/**
 * Micro View-Model responsible for computing Copilot model usage stats
 */
export class UsageStatsViewModel implements vscode.Disposable {
	private _listeners: Array<() => void> = [];
	private _sessionResultsCallback: (results: SessionScanResult[]) => void;
	private _currentWorkspaceId: string | null = null;

	public stats: UsageStatItem[] = [];
	public totalRequests = 0;

	constructor(
		private readonly unifiedDataService: UnifiedSessionDataService,
		private readonly context: vscode.ExtensionContext,
		private readonly logger: ILogger
	) {
		this._currentWorkspaceId = this.extractCurrentWorkspaceId();
		this.logger.info?.(`UsageStatsVM: Workspace ID = ${this._currentWorkspaceId || 'none'}`);

		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		this._sessionResultsCallback = async (waste: SessionScanResult[]) => {
			try {
				const results = await this.unifiedDataService.getRawSessionResults();
				this.processSessionResults(results);
			} catch (e) { this.logger.error('UsageStatsVM: process error', e); }
		};
		this.unifiedDataService.onRawSessionResultsUpdated(this._sessionResultsCallback);
		this.initializeStats();
	}

	private extractCurrentWorkspaceId(): string | null {
		try {
			if (!this.context.storageUri) { return null; }
			const decoded = decodeURIComponent(this.context.storageUri.toString());
			const m = decoded.match(/[\/\\]workspaceStorage[\/\\]([^\/\\]+)(?:[\/\\].*)?$/);
			return m?.[1] ?? null;
		} catch { return null; }
	}

	private async initializeStats(): Promise<void> {
		try {
			const results = await this.unifiedDataService.getRawSessionResults();
			this.processSessionResults(results);
		} catch (e) {
			this.logger.error('UsageStatsVM: initialize failed', e);
		}
	}

	private filterByWorkspace(results: SessionScanResult[]): SessionScanResult[] {
		if (!this._currentWorkspaceId) { return results; }
		return results.filter(r => r.harvestedMetadata?.workspaceId === this._currentWorkspaceId);
	}

	private processSessionResults(results: SessionScanResult[]): void {
		const filtered = this.filterByWorkspace(results);
		if (filtered.length === 0) { this.stats = []; this.totalRequests = 0; this.emit(); return; }

		const modelUsage = new Map<string, number>();
		const getModelLabel = (request: any): string => {
			try {
				const details: unknown = request?.result?.details;
				if (typeof details === 'string' && details.trim()) {
					const cleaned = details.split(' • ')[0]?.trim();
					if (cleaned) { return cleaned; }
				}
			} catch { }
			const modelId = request?.modelId;
			return typeof modelId === 'string' && modelId.length > 0 ? modelId : 'unknown-model';
		};

		for (const result of filtered) {
			for (const req of result.session.turns) {
				const label = getModelLabel(req);
				const rounds = req.result?.metadata?.toolCallRounds;

				if (Array.isArray(rounds) && rounds.length) {
					const prev = modelUsage.get(label) || 0; modelUsage.set(label, prev + rounds.length);
				} else {
					const prev = modelUsage.get(label) || 0; modelUsage.set(label, prev + 1);
				}
			}
		}

		const total = Array.from(modelUsage.values()).reduce((a, b) => a + b, 0);
		const newStats: UsageStatItem[] = Array.from(modelUsage.entries()).map(([model, count]) => {
			const prev = this.stats.find(s => s.model === model)?.count ?? 0;
			return { model, count, updated: prev !== count };
		}).sort((a, b) => b.count - a.count);

		this.stats = newStats;
		this.totalRequests = total;
		this.emit();
	}

	public hasData(): boolean { return this.stats.length > 0; }

	public async refresh(): Promise<void> {
		const results = await this.unifiedDataService.getRawSessionResults();
		this.processSessionResults(results);
	}

	public async clear(): Promise<void> {
		this.stats = [];
		this.totalRequests = 0;
		this.emit();
	}

	public onChanged(listener: () => void): void { this._listeners.push(listener); }
	private emit(): void {
		for (const l of this._listeners) {
			try { l(); } catch (e) { this.logger.error('UsageStatsVM listener error', e); }
		}
	}

	public dispose(): void {
		this.unifiedDataService.removeRawSessionCallback(this._sessionResultsCallback);
		this._listeners = [];
	}
}
