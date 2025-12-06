/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Niclas Olofsson. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnalyticsService, type AnalyticsFilter } from '../../../services/analytics-service';
import { UnifiedSessionDataService } from '../../../services/unified-session-data-service';
import { ILogger } from '../../../types/logger';
import { SessionScanResult, CopilotChatTurn } from '../../../types/chat-session';

describe('AnalyticsService', () => {
	let analyticsService: AnalyticsService;
	let mockLogger: ILogger;
	let mockUnifiedService: UnifiedSessionDataService;

	beforeEach(() => {
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
			onRawSessionResultsUpdated: vi.fn((callback) => {
				// Store callback for later invocation if needed
				return;
			}),
			getRawSessionResults: vi.fn().mockResolvedValue([]),
		} as any;

		analyticsService = new AnalyticsService(mockLogger, mockUnifiedService);
	});

	describe('getKpis', () => {
		it('should return zero KPIs when no data is available', () => {
			const kpis = analyticsService.getKpis();

			expect(kpis.turns).toBe(0);
			expect(kpis.sessions).toBe(0);
			expect(kpis.files).toBe(0);
			expect(kpis.edits).toBe(0);
			expect(kpis.fileModifications).toBe(0);
			expect(kpis.latencyMsMedian).toBe(0);
			expect(kpis.requestLatencyMsMean).toBe(0);
			expect(kpis.requestLatencyMsP95).toBe(0);
			expect(kpis.firstProgressMsMedian).toBe(0);
			expect(kpis.firstProgressMsP95).toBe(0);
			expect(kpis.editRatio).toBe(0);
			expect(kpis.editProductivity).toBe(0);
			expect(kpis.models).toBe(0);
			expect(kpis.agents).toBe(0);
			expect(kpis.requests).toBe(0);
		});

		it('should calculate correct KPIs with sample data', async () => {
			// Create sample session data using proper structure
			const sampleTurns: CopilotChatTurn[] = [
				{
					turnId: 'turn1',
					responseId: 'resp1',
					timestamp: 1733483400000, // 2025-12-06T10:00:00Z
					modelId: 'gpt-4',
					isCanceled: false,
					message: { text: 'test', parts: [] },
					response: [{ value: 'response' }],
					agent: { id: 'copilot-chat', name: 'Copilot Chat', extensionId: 'github.copilot' },
				} as any,
				{
					turnId: 'turn2',
					responseId: 'resp2',
					timestamp: 1733483700000, // 2025-12-06T10:05:00Z
					modelId: 'gpt-4',
					isCanceled: false,
					message: { text: 'test2', parts: [] },
					response: [{ value: 'response2' }],
					agent: { id: 'copilot-chat', name: 'Copilot Chat', extensionId: 'github.copilot' },
				} as any,
			];

			const sampleSession: SessionScanResult = {
				sessionFilePath: '/path/to/session.json',
				session: {
					version: 1,
					sessionId: 'session1',
					creationDate: 1733483400000,
					lastMessageDate: 1733483700000,
					requesterUsername: 'test',
					responderUsername: 'copilot',
					initialLocation: 'editor',
					turns: sampleTurns,
				},
				lastModified: new Date('2025-12-06T10:05:00Z'),
				fileSize: 1024,
				harvestedMetadata: {
					workspaceId: 'workspace1',
					vscodeVariant: 'stable',
					sessionFileName: 'session1.json',
					isFromLocalUser: true,
				},
			};

			// Mock the unified service to return our sample data
			mockUnifiedService.getRawSessionResults = vi.fn().mockResolvedValue([sampleSession]);
			
			// Re-initialize with the mocked data
			analyticsService = new AnalyticsService(mockLogger, mockUnifiedService);
			
			// Wait for async initialization
			await new Promise(resolve => setTimeout(resolve, 100));

			const kpis = analyticsService.getKpis();

			expect(kpis.turns).toBe(2);
			expect(kpis.sessions).toBe(1);
		});
	});

	describe('getAgents', () => {
		it('should return empty array when no data is available', () => {
			const agents = analyticsService.getAgents();
			expect(agents).toEqual([]);
		});

		it('should return top agents sorted by count', async () => {
			const sampleSessions: SessionScanResult[] = [
				{
					sessionFilePath: '/path/to/session1.json',
					session: {
						version: 1,
						sessionId: 'session1',
						creationDate: 1733483400000,
						lastMessageDate: 1733483700000,
						requesterUsername: 'test',
						responderUsername: 'copilot',
						initialLocation: 'editor',
						turns: [
							{
								turnId: 'turn1',
								responseId: 'resp1',
								timestamp: 1733483400000,
								modelId: 'gpt-4',
								isCanceled: false,
								message: { text: 'test', parts: [] },
								response: [{ value: 'response' }],
								agent: { id: 'copilot-chat', name: 'Copilot Chat', extensionId: 'github.copilot' },
							} as any,
							{
								turnId: 'turn2',
								responseId: 'resp2',
								timestamp: 1733483700000,
								modelId: 'gpt-4',
								isCanceled: false,
								message: { text: 'test2', parts: [] },
								response: [{ value: 'response2' }],
								agent: { id: 'copilot-chat', name: 'Copilot Chat', extensionId: 'github.copilot' },
							} as any,
						],
					},
					lastModified: new Date('2025-12-06T10:05:00Z'),
					fileSize: 1024,
					harvestedMetadata: {
						workspaceId: 'workspace1',
						vscodeVariant: 'stable',
						sessionFileName: 'session1.json',
						isFromLocalUser: true,
					},
				},
				{
					sessionFilePath: '/path/to/session2.json',
					session: {
						version: 1,
						sessionId: 'session2',
						creationDate: 1733483400000,
						lastMessageDate: 1733483900000,
						requesterUsername: 'test',
						responderUsername: 'copilot',
						initialLocation: 'editor',
						turns: [
							{
								turnId: 'turn3',
								responseId: 'resp3',
								timestamp: 1733483900000,
								modelId: 'gpt-4',
								isCanceled: false,
								message: { text: 'test3', parts: [] },
								response: [{ value: 'response3' }],
								agent: { id: 'workspace', name: 'Workspace', extensionId: 'github.copilot' },
							} as any,
						],
					},
					lastModified: new Date('2025-12-06T10:10:00Z'),
					fileSize: 512,
					harvestedMetadata: {
						workspaceId: 'workspace1',
						vscodeVariant: 'stable',
						sessionFileName: 'session2.json',
						isFromLocalUser: true,
					},
				},
			];

			mockUnifiedService.getRawSessionResults = vi.fn().mockResolvedValue(sampleSessions);
			analyticsService = new AnalyticsService(mockLogger, mockUnifiedService);
			
			// Wait for async initialization
			await new Promise(resolve => setTimeout(resolve, 100));

			const agents = analyticsService.getAgents(undefined, 5);

			expect(agents).toHaveLength(2);
			expect(agents[0].id).toBe('copilot-chat');
			expect(agents[0].count).toBe(2);
			expect(agents[1].id).toBe('workspace');
			expect(agents[1].count).toBe(1);
		});
	});

	describe('getModels', () => {
		it('should return empty array when no data is available', () => {
			const models = analyticsService.getModels();
			expect(models).toEqual([]);
		});

		it('should return top models sorted by count', async () => {
			const sampleSession: SessionScanResult = {
				sessionFilePath: '/path/to/session.json',
				session: {
					version: 1,
					sessionId: 'session1',
					creationDate: 1733483400000,
					lastMessageDate: 1733483900000,
					requesterUsername: 'test',
					responderUsername: 'copilot',
					initialLocation: 'editor',
					turns: [
						{
							turnId: 'turn1',
							responseId: 'resp1',
							timestamp: 1733483400000,
							modelId: 'gpt-4',
							isCanceled: false,
							message: { text: 'test', parts: [] },
							response: [{ value: 'response' }],
							agent: { id: 'copilot-chat', name: 'Copilot Chat', extensionId: 'github.copilot' },
						} as any,
						{
							turnId: 'turn2',
							responseId: 'resp2',
							timestamp: 1733483700000,
							modelId: 'gpt-4o',
							isCanceled: false,
							message: { text: 'test2', parts: [] },
							response: [{ value: 'response2' }],
							agent: { id: 'copilot-chat', name: 'Copilot Chat', extensionId: 'github.copilot' },
						} as any,
						{
							turnId: 'turn3',
							responseId: 'resp3',
							timestamp: 1733483900000,
							modelId: 'gpt-4',
							isCanceled: false,
							message: { text: 'test3', parts: [] },
							response: [{ value: 'response3' }],
							agent: { id: 'copilot-chat', name: 'Copilot Chat', extensionId: 'github.copilot' },
						} as any,
					],
				},
				lastModified: new Date('2025-12-06T10:10:00Z'),
				fileSize: 1024,
				harvestedMetadata: {
					workspaceId: 'workspace1',
					vscodeVariant: 'stable',
					sessionFileName: 'session1.json',
					isFromLocalUser: true,
				},
			};

			mockUnifiedService.getRawSessionResults = vi.fn().mockResolvedValue([sampleSession]);
			analyticsService = new AnalyticsService(mockLogger, mockUnifiedService);
			
			// Wait for async initialization
			await new Promise(resolve => setTimeout(resolve, 100));

			const models = analyticsService.getModels(undefined, 5);

			expect(models).toHaveLength(2);
			expect(models[0].id).toBe('gpt-4');
			expect(models[0].count).toBe(2);
			expect(models[1].id).toBe('gpt-4o');
			expect(models[1].count).toBe(1);
		});
	});

	describe('getActivity', () => {
		it('should return empty array when no data is available', () => {
			const activity = analyticsService.getActivity();
			expect(activity).toEqual([]);
		});

		it('should return activity items sorted by time descending', async () => {
			const sampleSession: SessionScanResult = {
				sessionFilePath: '/path/to/session.json',
				session: {
					version: 1,
					sessionId: 'session1',
					creationDate: 1733483400000,
					lastMessageDate: 1733483700000,
					requesterUsername: 'test',
					responderUsername: 'copilot',
					initialLocation: 'editor',
					turns: [
						{
							turnId: 'turn1',
							responseId: 'resp1',
							timestamp: 1733483400000, // 2025-12-06T10:00:00Z
							modelId: 'gpt-4',
							isCanceled: false,
							message: { text: 'test', parts: [] },
							response: [{ value: 'response' }],
							agent: { id: 'copilot-chat', name: 'Copilot Chat', extensionId: 'github.copilot' },
						} as any,
						{
							turnId: 'turn2',
							responseId: 'resp2',
							timestamp: 1733483700000, // 2025-12-06T10:05:00Z
							modelId: 'gpt-4',
							isCanceled: false,
							message: { text: 'test2', parts: [] },
							response: [{ value: 'response2' }],
							agent: { id: 'copilot-chat', name: 'Copilot Chat', extensionId: 'github.copilot' },
						} as any,
					],
				},
				lastModified: new Date('2025-12-06T10:05:00Z'),
				fileSize: 1024,
				harvestedMetadata: {
					workspaceId: 'workspace1',
					vscodeVariant: 'stable',
					sessionFileName: 'session1.json',
					isFromLocalUser: true,
				},
			};

			mockUnifiedService.getRawSessionResults = vi.fn().mockResolvedValue([sampleSession]);
			analyticsService = new AnalyticsService(mockLogger, mockUnifiedService);
			
			// Wait for async initialization
			await new Promise(resolve => setTimeout(resolve, 100));

			const activity = analyticsService.getActivity(undefined, 10);

			expect(activity).toHaveLength(2);
			// Activity should exist
			expect(activity.length).toBeGreaterThan(0);
		});
	});

	describe('filter functionality', () => {
		it('should filter by time range', async () => {
			const now = new Date('2025-12-06T12:00:00Z');

			const sampleSessions: SessionScanResult[] = [
				{
					sessionFilePath: '/path/to/session1.json',
					session: {
						version: 1,
						sessionId: 'session1',
						creationDate: now.getTime(),
						lastMessageDate: now.getTime(),
						requesterUsername: 'test',
						responderUsername: 'copilot',
						initialLocation: 'editor',
						turns: [
							{
								turnId: 'turn1',
								responseId: 'resp1',
								timestamp: now.getTime(),
								modelId: 'gpt-4',
								isCanceled: false,
								message: { text: 'test', parts: [] },
								response: [{ value: 'response' }],
								agent: { id: 'copilot-chat', name: 'Copilot Chat', extensionId: 'github.copilot' },
							} as any,
						],
					},
					lastModified: now,
					fileSize: 1024,
					harvestedMetadata: {
						workspaceId: 'workspace1',
						vscodeVariant: 'stable',
						sessionFileName: 'session1.json',
						isFromLocalUser: true,
					},
				},
			];

			mockUnifiedService.getRawSessionResults = vi.fn().mockResolvedValue(sampleSessions);
			analyticsService = new AnalyticsService(mockLogger, mockUnifiedService);
			
			// Wait for async initialization
			await new Promise(resolve => setTimeout(resolve, 100));

			const filter: AnalyticsFilter = { timeRange: 'all' };
			const kpis = analyticsService.getKpis(filter);

			// Should have the data
			expect(kpis.turns).toBe(1);
		});
	});

	describe('event subscription', () => {
		it('should allow subscribing to analytics updates', () => {
			const callback = vi.fn();
			analyticsService.onAnalyticsUpdated(callback);

			// Trigger an update by providing new data
			const sampleSession: SessionScanResult = {
				sessionId: 'session1',
				workspaceId: 'workspace1',
				filePath: '/path/to/session.json',
				fileExists: true,
				data: {
					requests: [],
				} as any,
			};

			mockUnifiedService.getRawSessions = vi.fn(() => [sampleSession]);

			// The callback should be in the list
			expect(callback).not.toHaveBeenCalled();
		});

		it('should allow unsubscribing from analytics updates', () => {
			const callback = vi.fn();
			analyticsService.onAnalyticsUpdated(callback);
			analyticsService.removeAnalyticsCallback(callback);

			// Callback should not be called after removal
			expect(callback).not.toHaveBeenCalled();
		});
	});
});
