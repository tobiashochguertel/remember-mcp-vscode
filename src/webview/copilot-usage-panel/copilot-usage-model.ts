import { UnifiedSessionDataService } from '../../services/unified-session-data-service';
import { SessionScanResult } from '../../types/chat-session';
import { ILogger } from '../../types/logger';
import * as vscode from 'vscode';

/**
 * Model for Copilot Usage Panel
 * Manages data and business logic, provides observable interface
 * 
 * NEW: Uses raw session data for accurate model usage counting based on toolCallRounds
 * ENHANCED: Filters sessions by current workspace for workspace-specific usage stats
 */
export class CopilotUsageModel {
	private _listeners: Array<() => void> = [];
	private _sessionResultsCallback: (results: SessionScanResult[]) => void;
	private _currentWorkspaceId: string | null = null;

	// View model
	public stats: Array<{ model: string; count: number; updated: boolean }> = [];
	public totalRequests: number = 0;


	constructor(
		private readonly unifiedDataService: UnifiedSessionDataService, 
		private readonly context: vscode.ExtensionContext,
		private readonly _logger: ILogger
	) {
		// Extract current workspace ID from extension context
		this._currentWorkspaceId = this.extractCurrentWorkspaceId();
		this._logger.info(`Workspace filtering - Current workspace ID: ${this._currentWorkspaceId || 'none'}`);

		// Set up callback for session results from unified data service
		this._sessionResultsCallback = (results: SessionScanResult[]) => {
			this._logger.info('Session results updated:', results.length, 'sessions');
			try {
				this.processSessionResults(results);
			} catch (error) {
				this._logger.error('Error processing session results:', error);
			}
		};

		// Register with unified data service for real-time session updates
		this.unifiedDataService.onRawSessionResultsUpdated(this._sessionResultsCallback);

		// Initialize stats with current data
		this.initializeStats();
	}

	/**
	 * Extract current workspace ID from ExtensionContext.storageUri
	 */
	private extractCurrentWorkspaceId(): string | null {
		if (!this.context.storageUri) {
			this._logger.debug('No storageUri available in ExtensionContext');
			return null;
		}

		try {
			// Convert URI to string and handle URL decoding
			const uriString = this.context.storageUri.toString();
			const decodedPath = decodeURIComponent(uriString);
			
			this._logger.trace(`ExtensionContext.storageUri: ${decodedPath}`);
			
			// Extract workspace ID from the path: .../workspaceStorage/{workspaceId}
			const workspaceStorageMatch = decodedPath.match(/[\/\\]workspaceStorage[\/\\]([^\/\\]+)(?:[\/\\].*)?$/);
			
			if (workspaceStorageMatch && workspaceStorageMatch[1]) {
				const workspaceId = workspaceStorageMatch[1];
				this._logger.debug(`Extracted workspace ID: ${workspaceId}`);
				return workspaceId;
			} else {
				this._logger.debug('No workspace ID found in storageUri path');
				return null;
			}
		} catch (error) {
			this._logger.error('Error extracting workspace ID from storageUri:', error);
			return null;
		}
	}

	/**
	 * Filter session results by current workspace ID
	 */
	private filterSessionsByWorkspace(results: SessionScanResult[]): SessionScanResult[] {
		// If no current workspace ID, return all sessions (fallback behavior)
		if (!this._currentWorkspaceId) {
			this._logger.debug('No current workspace ID - returning all sessions');
			return results;
		}

		// Filter sessions to only include those from the current workspace
		const filtered = results.filter(result => {
			const sessionWorkspaceId = result.harvestedMetadata?.workspaceId;
			const matches = sessionWorkspaceId === this._currentWorkspaceId;
			
			if (!matches) {
				this._logger.trace(`Filtering out session ${result.session.sessionId} from workspace ${sessionWorkspaceId}`);
			}
			
			return matches;
		});

		this._logger.debug(`Workspace filtering: ${results.length} total sessions, ${filtered.length} matching current workspace`);
		return filtered;
	}

	/**
	 * Initialize stats from current unified data service data
	 */
	private async initializeStats(): Promise<void> {
		try {
			const results = await this.unifiedDataService.getRawSessionResults();
			this.processSessionResults(results);
		} catch (error) {
			console.error('Error initializing stats:', error);
		}
	}

	/**
	 * Process session results to extract model usage statistics
	 * Uses toolCallRounds from session data for accurate backend LLM call counting
	 * ENHANCED: Filters sessions by current workspace for workspace-specific stats
	 */
	private processSessionResults(results: SessionScanResult[]): void {
		this._logger.info(`Processing ${results.length} session results`);

		// Filter sessions by current workspace
		const filteredResults = this.filterSessionsByWorkspace(results);
		this._logger.info(`Filtered to ${filteredResults.length} sessions for current workspace (${this._currentWorkspaceId || 'all'})`);
		if(filteredResults.length === 0) {return;}

		// Reset model usage counts (don't accumulate across refreshes)
		const modelUsage = new Map<string, number>();

		// Process each filtered session result
		filteredResults.forEach(result => {
			const session = result.session;
			const metadata = result.harvestedMetadata;
			
			// Log session processing with metadata
			this._logger.trace(`Processing session ${session.sessionId} from workspace ${metadata?.workspaceId || 'unknown'} (${metadata?.vscodeVariant || 'unknown'})`);
			
			// Process each request in the session
			session.requests.forEach(request => {
				// Extract model ID (with fallback for missing modelId)
				const modelId = request.modelId || 'unknown-model';
				
				// Process toolCallRounds for accurate backend call counting
				// According to Session Internals wiki: "toolCallRounds represents the actual backend LLM calls"
				const toolCallRounds = request.result?.metadata?.toolCallRounds;
				if (toolCallRounds && Array.isArray(toolCallRounds)) {
					toolCallRounds.forEach((round, index) => {
						// Each toolCallRound represents one backend LLM call
						const currentCount = modelUsage.get(modelId) || 0;
						modelUsage.set(modelId, currentCount + 1);
						
						this._logger.trace(`Request ${request.requestId}, Round ${index}: model=${modelId}, roundId=${round.id}`);
					});
				} else {
					// Fallback: if no toolCallRounds, count as 1 request (for older session format compatibility)
					const currentCount = modelUsage.get(modelId) || 0;
					modelUsage.set(modelId, currentCount + 1);
					
					this._logger.trace(`Request ${request.requestId}: model=${modelId}, no toolCallRounds (fallback count=1)`);
				}
			});
		});

		const totalRequests = Array.from(modelUsage.values()).reduce((sum, count) => sum + count, 0);

		// Create updated stats array with change detection using existing stats
		const stats = Array.from(modelUsage.entries())
			.map(([model, count]) => {
				const previousStat = this.stats.find(s => s.model === model);
				const previousCount = previousStat?.count || 0;
				return {
					model,
					count,
					updated: previousCount !== count
				};
			})
			.sort((a, b) => b.count - a.count);

		this.stats = stats;
		this.totalRequests = totalRequests;

		this._logger.info(`Updated stats - Total: ${totalRequests} requests across ${stats.length} models`);

		// Notify all listeners (lightweight notification)
		try {
			this._listeners.forEach(listener => {
				this._logger.trace('Notifying listener:', listener);
				return listener();
			});
		} catch (error) {
			this._logger.error('Error notifying listeners:', error);
		}
	}

	/**
	 * Subscribe to changes in data
	 */
	public onDataChanged(listener: () => void): void {
		this._listeners.push(listener);
	}

	/**
	 * Clear all usage statistics
	 * TODO: Implement session-based clear functionality in unified data service
	 */
	public async clearStats(): Promise<void> {
		// For now, reset local stats since we don't have session-based clearing yet
		this._logger.warn('Clear stats: Resetting local statistics only (session data unchanged)');

		this.stats = [];
		this.totalRequests = 0;

		// Notify listeners
		this._listeners.forEach(listener => listener());
	}

	/**
	 * Refresh statistics from the data source
	 */
	public async refreshStats(): Promise<void> {
		try {
			const results = await this.unifiedDataService.getRawSessionResults(true); // Force refresh
			this.processSessionResults(results);
		} catch (error) {
			console.error('Error refreshing stats:', error);
		}
	}

	/**
	 * Check if there is any usage data
	 */
	public hasData(): boolean {
		return this.stats.length > 0;
	}

	/**
	 * Dispose of the model and clean up listeners
	 */
	public dispose(): void {
		// Remove callback from unified data service
		this.unifiedDataService.removeRawSessionCallback(this._sessionResultsCallback);

		// Clear local listeners
		this._listeners = [];
	}
}
