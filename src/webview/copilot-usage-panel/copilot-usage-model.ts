import { UnifiedSessionDataService } from '../../services/unified-session-data-service';
import { SessionScanResult } from '../../types/chat-session';
import { ILogger } from '../../types/logger';

/**
 * Model for Copilot Usage Panel
 * Manages data and business logic, provides observable interface
 * 
 * NEW: Uses raw session data for accurate model usage counting based on toolCallRounds
 */
export class CopilotUsageModel {
	private _listeners: Array<() => void> = [];
	private _sessionResultsCallback: (results: SessionScanResult[]) => void;

	// View model
	public stats: Array<{ model: string; count: number; updated: boolean }> = [];
	public totalRequests: number = 0;


	constructor(
		private readonly unifiedDataService: UnifiedSessionDataService, 
		private readonly _logger: ILogger
	) {
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
	 */
	private processSessionResults(results: SessionScanResult[]): void {
		this._logger.info(`Processing ${results.length} session results`);

		// Reset model usage counts (don't accumulate across refreshes)
		const modelUsage = new Map<string, number>();

		// Process each session result
		results.forEach(result => {
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
