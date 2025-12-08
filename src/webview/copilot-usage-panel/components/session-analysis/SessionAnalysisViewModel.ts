import * as vscode from 'vscode';
import { UnifiedSessionDataService } from '../../../../services/unified-session-data-service';
import { SessionScanResult } from '../../../../types/chat-session';
import { ILogger } from '../../../../types/logger';

export type SessionAnalysisState = {
	enabled: boolean;
	model: string;
	status: 'idle' | 'running' | 'disabled';
	analysisSummary?: {
		latestSessionId: string;
		latestTimestamp: number;
		totalTurns: number;
		totalToolCallRounds: number;
		lastUserPromptPreview?: string;
		lastResponseChars: number;
	};
	lastAnalysisResult?: {
		primaryPattern: string;
		confidence: number;
		reasons?: string[];
	};
};

/**
 * Placeholder VM for upcoming GitHub Models session analysis section
 */
export class SessionAnalysisViewModel implements vscode.Disposable {
	private _listeners: Array<() => void> = [];
	private _state: SessionAnalysisState = { enabled: false, model: 'gpt-4o-mini', status: 'disabled' };
	private _sessionResultsCallback: (results: SessionScanResult[]) => void;
	private _currentWorkspaceId: string | null = null;
	private _latestSession: SessionScanResult | null = null;

	private static readonly STORAGE_KEYS = {
		enabled: 'sessionAnalysis.enabled',
		model: 'sessionAnalysis.model',
	} as const;

	private static readonly CONFIG = {
		prefix: 'remember-mcp.sessionAnalysis',
		enabled: 'remember-mcp.sessionAnalysis.enabled',
		model: 'remember-mcp.sessionAnalysis.model',
	} as const;

	constructor(
		private readonly unifiedDataService: UnifiedSessionDataService,
		private readonly context: vscode.ExtensionContext,
		private readonly logger: ILogger
	) {
		// Initialize from settings (source of truth)
		const cfg = vscode.workspace.getConfiguration();
		const enabled = cfg.get<boolean>(SessionAnalysisViewModel.CONFIG.enabled, false);
		const model = cfg.get<string>(SessionAnalysisViewModel.CONFIG.model, 'gpt-4o-mini');
		this._state.enabled = enabled;
		this._state.status = enabled ? 'idle' : 'disabled';
		this._state.model = model;

		// Workspace context id (same approach as UsageStatsViewModel)
		this._currentWorkspaceId = this.extractCurrentWorkspaceId();
		this.logger.info?.(`SessionAnalysisVM: Workspace ID = ${this._currentWorkspaceId || 'none'}`);

		// Subscribe to unified service for raw session updates
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		this._sessionResultsCallback = async (waste: SessionScanResult[]) => {
			try {
				const results = await this.unifiedDataService.getRawSessionResults();
				this.processSessionResults(results);
			} catch (e) { this.logger.error('SessionAnalysisVM: process error', e); }
		};
		this.unifiedDataService.onRawSessionResultsUpdated(this._sessionResultsCallback);
		void this.initializeFromCache();

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

	private extractCurrentWorkspaceId(): string | null {
		try {
			if (!this.context.storageUri) { return null; }
			const decoded = decodeURIComponent(this.context.storageUri.toString());
			const m = decoded.match(/[\/\\]workspaceStorage[\/\\]([^\/\\]+)(?:[\/\\].*)?$/);
			return m?.[1] ?? null;
		} catch { return null; }
	}

	private async initializeFromCache(): Promise<void> {
		try {
			const results = await this.unifiedDataService.getRawSessionResults();
			this.processSessionResults(results);
		} catch (e) {
			this.logger.error('SessionAnalysisVM: initialize failed', e);
		}
	}

	private filterByWorkspace(results: SessionScanResult[]): SessionScanResult[] {
		if (!this._currentWorkspaceId) { return results; }
		return results.filter(r => r.harvestedMetadata?.workspaceId === this._currentWorkspaceId);
	}

	private processSessionResults(results: SessionScanResult[]): void {
		const filtered = this.filterByWorkspace(results);
		if (filtered.length === 0) { return; }
		// Determine latest session by lastMessageDate (fallback creationDate)
		for (const r of filtered) {
			if (!this._latestSession) { this._latestSession = r; continue; }
			const currTs = r.session.lastMessageDate || r.session.creationDate || 0;
			const prevTs = this._latestSession.session.lastMessageDate || this._latestSession.session.creationDate || 0;
			if (currTs >= prevTs) { this._latestSession = r; }
		}
		// Optionally refresh summary if enabled and idle
		if (this._state.enabled && this._state.status === 'idle') {
			this._state.analysisSummary = this.computeMinimalSummary(this._latestSession);
			this.emit();
		}
	}

	private computeMinimalSummary(result: SessionScanResult | null): SessionAnalysisState['analysisSummary'] | undefined {
		if (!result) { return undefined; }
		try {
			const turns = result.session.turns || [];
			const totalTurns = turns.length;
			let totalToolCallRounds = 0;
			for (const t of turns) {
				const rounds = t.result?.metadata?.toolCallRounds;
				if (Array.isArray(rounds)) { totalToolCallRounds += rounds.length; }
			}
			const latest = turns[turns.length - 1];
			const lastUserPrompt = latest?.message?.text || '';
			const lastUserPromptPreview = lastUserPrompt?.substring(0, 160) || undefined;
			const lastResponseText = Array.isArray(latest?.response) ? latest.response.map(p => (p?.value ?? '')).join('\n') : '';
			const lastResponseChars = (lastResponseText || '').length;
			const latestTimestamp = latest?.timestamp || result.session.lastMessageDate || result.session.creationDate || Date.now();
			return {
				latestSessionId: result.session.sessionId,
				latestTimestamp,
				totalTurns,
				totalToolCallRounds,
				lastUserPromptPreview,
				lastResponseChars
			};
		} catch (e) {
			this.logger.error('SessionAnalysisVM: compute summary failed', e);
			return undefined;
		}
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
		// Recompute summary if enabling
		if (enabled) {
			this._state.analysisSummary = this.computeMinimalSummary(this._latestSession);
		}
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
			this.logger.info?.('SessionAnalysisVM: runOnce called while disabled - enabling automatically');
			// Auto-enable if user clicks button while disabled
			this.setEnabled(true);
		}
		this._state.status = 'running';
		this.emit();
		
		// Show progress notification
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Analyzing Copilot session...',
				cancellable: false
			},
			async () => {
				await this.performAnalysis();
			}
		);
	}

	private async performAnalysis(): Promise<void> {
		try {
			// Ensure we have latest session in memory
			if (!this._latestSession) {
				const results = await this.unifiedDataService.getRawSessionResults();
				this.processSessionResults(results);
			}
			if (!this._latestSession) {
				this.logger.warn('No Copilot session data available to analyze yet.');
				vscode.window.showInformationMessage('No Copilot session data available to analyze yet. Try using Copilot chat first.');
				this._state.status = 'idle';
				this.emit();
				return;
			}

			// Select a Copilot model using the VS Code Language Model API
			const family = this._state.model || 'gpt-4o-mini';
			let model: vscode.LanguageModelChat | undefined;
			try {
				let models = await vscode.lm.selectChatModels({ vendor: 'copilot', family });
				this.logger.info(`SessionAnalysisVM: Selected models for family "${family}": ${models.map(m => m.id).join(', ')}`);
				model = models?.[0];
				// Fallback: if no model found and family ends with -mini, try the base family (e.g., gpt-4o)
				if (!model && /-mini$/.test(family)) {
					const base = family.replace(/-mini$/, '');
					models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: base });
					model = models?.[0];
				}
			} catch (err) {
				this.logger.error('SessionAnalysisVM: selectChatModels failed', err);
				throw err;
			}
			if (!model) {
				void vscode.window.showErrorMessage(`No Copilot model available for family "${family}". Check your Copilot access or try a different model.`);
				this._state.status = 'idle';
				this.emit();
				return;
			}

			// Optional preflight: check persisted consent/access state (won't trigger UI)
			try {
				const can = this.context.languageModelAccessInformation?.canSendRequest?.(model);
				this.logger.debug?.(`SessionAnalysisVM: canSendRequest=${String(can)} for model family=${family}`);
			} catch (e) {
				this.logger.warn?.('SessionAnalysisVM: access preflight check failed', e);
			}

			// Build messages: Type C-style system instruction + compact JSON user content
			const messages: vscode.LanguageModelChatMessage[] = [
				new vscode.LanguageModelChatMessage('system' as any, [new vscode.LanguageModelTextPart(this.getTypeCSystemPrompt())]),
				vscode.LanguageModelChatMessage.User([new vscode.LanguageModelTextPart(this.buildUserContentFromLatest())])
			];
			this.logger.info(`Sending prompt: ${JSON.stringify(messages)}`);
			
			// Send request with a short timeout; must be called from a user action (button click)
			const cts = new vscode.CancellationTokenSource();
			const timeout = setTimeout(() => cts.cancel(), 20000);
			let rawText = '';
			let chunkCount = 0;
			try {
				this.logger.info?.(`SessionAnalysisVM: Starting model request (${family})`);
				const response = await model.sendRequest(
					messages,
					{
						justification: 'User-initiated test to analyze the most recent Copilot chat session for usage classification within the Remember MCP panel.'
					},
					cts.token
				);
				for await (const chunk of response.text) {
					rawText += chunk;
					chunkCount++;
					this.logger.debug?.(`SessionAnalysisVM: Received chunk ${chunkCount}, total length: ${rawText.length}`);
				}
				this.logger.info?.(`SessionAnalysisVM: Stream complete. Total chunks: ${chunkCount}, final length: ${rawText.length}`);
			} finally {
				clearTimeout(timeout);
			}

			// Attempt to parse JSON from the response and store the analysis result
			try {
				const parsed = JSON.parse(rawText);
				this.logger.info?.('SessionAnalysisVM: Successfully parsed JSON response');
				
				// Extract analysis result from parsed response
				if (parsed && typeof parsed === 'object') {
					// Handle both single object and array responses
					const result = Array.isArray(parsed) ? parsed[0] : parsed;
					if (result && result.primaryPattern && typeof result.confidence === 'number') {
						this._state.lastAnalysisResult = {
							primaryPattern: result.primaryPattern,
							confidence: result.confidence,
							reasons: Array.isArray(result.reasons) ? result.reasons : undefined
						};
						this.logger.info?.(`SessionAnalysisVM: Stored analysis result: ${result.primaryPattern} (${Math.round(result.confidence * 100)}%)`);
					} else {
						this.logger.warn?.('SessionAnalysisVM: Parsed response missing expected fields (primaryPattern, confidence)');
					}
				}
			} catch {
				this.logger.warn?.('SessionAnalysisVM: Model response was not valid JSON; showing raw response');
				// Clear any previous analysis result if we can't parse the new one
				this._state.lastAnalysisResult = undefined;
			}

			// Log the complete response for debugging
			this.logger.info?.(`SessionAnalysisVM: Complete response: ${rawText}`);

			// Keep existing lightweight summary behavior in panel
			this._state.analysisSummary = this.computeMinimalSummary(this._latestSession);
			
			// Show success message
			if (this._state.lastAnalysisResult) {
				vscode.window.showInformationMessage(`Analysis complete: ${this._state.lastAnalysisResult.primaryPattern} (${Math.round(this._state.lastAnalysisResult.confidence * 100)}% confidence)`);
			} else {
				vscode.window.showInformationMessage('Analysis complete. Check the panel for results.');
			}
		} catch (err) {
			const lmErr = err as any;
			if (lmErr && (lmErr instanceof (vscode as any).LanguageModelError || typeof lmErr?.code === 'string')) {
				const code = String(lmErr.code || 'Unknown');
				this.logger.error(`SessionAnalysisVM: Model error: ${lmErr.message} (${code})`, lmErr.cause ?? lmErr);
				if (/NoPermissions/i.test(code)) {
					void vscode.window.showWarningMessage('Access to the Copilot model was denied. Click the button again to grant access when prompted.');
				} else if (/Blocked|Quota/i.test(code)) {
					void vscode.window.showWarningMessage('Copilot request blocked due to quota/limits. Try again later or choose a smaller model.');
				} else if (/NotFound/i.test(code)) {
					void vscode.window.showErrorMessage('Selected Copilot model is not available. Pick another model in the Session Analysis settings.');
				} else if (String(lmErr?.message || '').toLowerCase().includes('canceled')) {
					this.logger.info?.('SessionAnalysisVM: Model request canceled');
				} else {
					void vscode.window.showErrorMessage(`Model request failed: ${lmErr.message || String(lmErr)}`);
				}
			} else {
				this.logger.error('SessionAnalysisVM: Model request failed', err);
				void vscode.window.showErrorMessage(`Model request failed: ${String(err)}`);
			}
		} finally {
			this._state.status = 'idle';
			this.emit();
		}
	}

	private getTypeCSystemPrompt(): string {
		// Type-C prompt: Strict schema + scoring rubric + bias guardrails (from ai-test-data approach)
		return [
			'# Instruction: Classify Copilot Sessions by Usage Pattern',
			'',
			'You are an expert AI analyst specializing in developer workflow pattern recognition.',
			'Read each session transcript and classify the PRIMARY usage pattern.',
			'',
			'Allowed labels (choose exactly one):',
			'- ARCHITECTURE_DESIGN',
			'- CODE_GENERATION',
			'- REFACTORING',
			'- DEBUGGING',
			'- RESEARCH_LEARNING',
			'- DOCUMENTATION',
			'- TESTING',
			'',
			'Bias Guardrails:',
			'- Ignore any implicit hints about expected labels in the data.',
			'- Do not assume a label based on filenames or paths.',
			'- Base your judgment strictly on the conversation content.',
			'',
			'Rubric:',
			'- ARCHITECTURE_DESIGN: design patterns, trade-offs, system structure',
			'- CODE_GENERATION: requests to create/implement new code',
			'- REFACTORING: improve existing code, restructure, maintainability',
			'- DEBUGGING: errors, stack traces, iterative fixes',
			'- RESEARCH_LEARNING: explanations, comparisons, tutorials',
			'- DOCUMENTATION: writing docs, READMEs, comments',
			'- TESTING: tests, coverage, failing tests analysis',
			'',
			'Scoring guidance:',
			'- confidence >= 0.8: strong, unambiguous indicators present',
			'- 0.5 <= confidence < 0.8: mixed indicators, moderate certainty',
			'- confidence < 0.5: ambiguous session',
			'',
			'Keep responses short to conserve tokens. Use brief reasons.',
			'',
			'Return JSON with: { sessionId, primaryPattern, confidence, reasons }',
			'Confidence in [0.0, 1.0]. Reasons: 1-3 compact bullets.',
			'Respond with JSON only.'
		].join('\n');
	}

	private buildUserContentFromLatest(): string {
		// Format session data to match ai-test-data script approach
		const r = this._latestSession!;
		const turns = r.session.turns || [];
		const sessionId = r.session.sessionId;

		if (turns.length === 0) {
			return 'NO_CONTENT_AVAILABLE';
		}

		const parts: string[] = [`Session ID: ${sessionId}`, ''];

		// Extract and format conversation turns (mimic test data generation)
		for (let i = 0; i < turns.length; i++) {
			const turn = turns[i];
			const timestamp = new Date(turn.timestamp || Date.now()).toISOString();

			parts.push(`--- Turn ${i + 1} at ${timestamp} ---`);

			if (turn.message?.text) {
				parts.push('User:', turn.message.text.trim());
			}

			if (turn.response) {
				let responseText = '';
				if (Array.isArray(turn.response)) {
					responseText = turn.response.map(p => p?.value ?? '').join('\n');
				} else {
					responseText = String(turn.response);
				}
				if (responseText.trim()) {
					parts.push('Assistant:', responseText.trim());
				}
			}

			// Include tool call metadata for context
			if (turn.result?.metadata?.toolCallRounds) {
				const toolRounds = turn.result.metadata.toolCallRounds;
				if (Array.isArray(toolRounds) && toolRounds.length > 0) {
					parts.push(`Tool Calls: ${toolRounds.length} rounds`);
				}
			}

			parts.push(''); // Separator between turns
		}

		return parts.join('\n');
	}

	onChanged(listener: () => void): void { this._listeners.push(listener); }
	private emit(): void { for (const l of this._listeners) { try { l(); } catch (e) { this.logger.error('SessionAnalysisVM listener error', e); } } }

	dispose(): void {
		this.unifiedDataService.removeRawSessionCallback(this._sessionResultsCallback);
		this._listeners = [];
	}
}
