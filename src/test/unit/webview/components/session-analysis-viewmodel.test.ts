/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Niclas Olofsson. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionAnalysisViewModel } from '../../../../webview/copilot-usage-panel/components/session-analysis/SessionAnalysisViewModel';
import { UnifiedSessionDataService } from '../../../../services/unified-session-data-service';
import { ILogger } from '../../../../types/logger';

// Mock vscode module
vi.mock('vscode', async () => {
	const actual = await vi.importActual('vscode');
	return {
		...actual,
		workspace: {
			getConfiguration: vi.fn(),
			onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
			workspaceFolders: undefined,
		},
		window: {
			showErrorMessage: vi.fn(),
		},
		lm: {
			selectChatModels: vi.fn(),
		},
	};
});

describe('SessionAnalysisViewModel', () => {
	let viewModel: SessionAnalysisViewModel;
	let mockLogger: ILogger;
	let mockUnifiedService: UnifiedSessionDataService;
	let mockContext: any;

	beforeEach(() => {
		vi.clearAllMocks();

		// Create mock logger
		mockLogger = {
			trace: vi.fn(),
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		};

		// Create mock unified service
		mockUnifiedService = {
			onRawSessionResultsUpdated: vi.fn((_callback) => {
				return;
			}),
			getRawSessionResults: vi.fn().mockResolvedValue([]),
			removeRawSessionCallback: vi.fn(),
		} as any;

		// Create mock extension context
		mockContext = {
			subscriptions: [],
			workspaceState: {
				get: vi.fn(),
				update: vi.fn(),
			},
			globalState: {
				get: vi.fn(),
				update: vi.fn(),
			},
			extensionPath: '/mock/path',
			languageModelAccessInformation: {
				canSendRequest: vi.fn(),
			},
		};
	});

	describe('model configuration', () => {
		it('should initialize with gpt-4o-mini as default model when not configured', async () => {
			const vscode = await import('vscode');
			const mockGetConfiguration = vscode.workspace.getConfiguration as any;
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string, defaultValue: any) => defaultValue),
			});

			viewModel = new SessionAnalysisViewModel(mockUnifiedService, mockContext, mockLogger);
			const state = viewModel.getState();

			expect(state.model).toBe('gpt-4o-mini');
		});

		it('should use configured model when set in settings', async () => {
			const vscode = await import('vscode');
			const mockGetConfiguration = vscode.workspace.getConfiguration as any;
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string, defaultValue: any) => {
					if (key === 'remember-mcp.sessionAnalysis.model') {
						return 'gpt-4o';
					}
					return defaultValue;
				}),
			});

			viewModel = new SessionAnalysisViewModel(mockUnifiedService, mockContext, mockLogger);
			const state = viewModel.getState();

			expect(state.model).toBe('gpt-4o');
		});

		it('should accept any model family string', async () => {
			const vscode = await import('vscode');
			const testModels = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1-preview', 'claude-3', 'custom-model'];

			for (const modelName of testModels) {
				const mockGetConfiguration = vscode.workspace.getConfiguration as any;
				mockGetConfiguration.mockReturnValue({
					get: vi.fn((key: string, defaultValue: any) => {
						if (key === 'remember-mcp.sessionAnalysis.model') {
							return modelName;
						}
						return defaultValue;
					}),
				});

				viewModel = new SessionAnalysisViewModel(mockUnifiedService, mockContext, mockLogger);
				const state = viewModel.getState();

				expect(state.model).toBe(modelName);
				viewModel.dispose();
			}
		});

		it('should update model when configuration changes', async () => {
			const vscode = await import('vscode');
			let configChangeCallback: any;
			const mockOnDidChangeConfiguration = vscode.workspace.onDidChangeConfiguration as any;
			mockOnDidChangeConfiguration.mockImplementation((callback: any) => {
				configChangeCallback = callback;
				return { dispose: vi.fn() };
			});

			const mockGetConfiguration = vscode.workspace.getConfiguration as any;
			let currentModel = 'gpt-4o-mini';
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string, defaultValue: any) => {
					if (key === 'remember-mcp.sessionAnalysis.model') {
						return currentModel;
					}
					return defaultValue;
				}),
			});

			viewModel = new SessionAnalysisViewModel(mockUnifiedService, mockContext, mockLogger);
			expect(viewModel.getState().model).toBe('gpt-4o-mini');

			// Simulate configuration change
			currentModel = 'gpt-4o';
			configChangeCallback({
				affectsConfiguration: (key: string) => key === 'remember-mcp.sessionAnalysis.model',
			});

			expect(viewModel.getState().model).toBe('gpt-4o');
		});
	});

	describe('model validation removed', () => {
		it('should not restrict model to predefined enum values', async () => {
			const vscode = await import('vscode');
			// Test that arbitrary model names are accepted (no enum restriction)
			const arbitraryModels = ['new-model-2025', 'experimental-model', 'custom-llm'];

			for (const modelName of arbitraryModels) {
				const mockGetConfiguration = vscode.workspace.getConfiguration as any;
				mockGetConfiguration.mockReturnValue({
					get: vi.fn((key: string, defaultValue: any) => {
						if (key === 'remember-mcp.sessionAnalysis.model') {
							return modelName;
						}
						return defaultValue;
					}),
				});

				viewModel = new SessionAnalysisViewModel(mockUnifiedService, mockContext, mockLogger);
				const state = viewModel.getState();

				// Should accept any string without validation
				expect(state.model).toBe(modelName);
				expect(typeof state.model).toBe('string');
				viewModel.dispose();
			}
		});
	});
});
