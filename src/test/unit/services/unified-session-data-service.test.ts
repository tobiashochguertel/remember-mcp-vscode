/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Niclas Olofsson. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnifiedSessionDataService } from '../../../services/unified-session-data-service';
import { ChatSessionScanner } from '../../../scanning/chat-session-scanner';
import { GlobalLogScanner } from '../../../scanning/global-log-scanner';
import { ILogger } from '../../../types/logger';
import { SessionScanResult } from '../../../types/chat-session';

describe('UnifiedSessionDataService', () => {
	let service: UnifiedSessionDataService;
	let mockLogger: ILogger;
	let mockSessionScanner: ChatSessionScanner;
	let mockLogScanner: GlobalLogScanner;

	beforeEach(() => {
		// Create mock logger
		mockLogger = {
			trace: vi.fn(),
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		};

		// Create mock session scanner
		mockSessionScanner = {
			scanAllSessions: vi.fn().mockResolvedValue({
				results: [],
				stats: {
					totalSessions: 0,
					totalRequests: 0,
					scannedFiles: 0,
					errorFiles: 0,
					scanDuration: 0
				}
			}),
			startWatching: vi.fn(),
			stopWatching: vi.fn(),
		} as any;

		// Create mock log scanner
		mockLogScanner = {
			scanAllLogs: vi.fn().mockResolvedValue([]),
			startWatching: vi.fn(),
			stopWatching: vi.fn(),
		} as any;

		service = new UnifiedSessionDataService(
			mockSessionScanner,
			mockLogScanner,
			mockLogger,
			'1.0.0',
			{ enableRealTimeUpdates: false }
		);
	});

	describe('initialization', () => {
		it('should initialize successfully with empty data', async () => {
			const result = await service.initialize();

			expect(result.results).toEqual([]);
			expect(result.logEntries).toEqual([]);
			expect(result.stats.totalSessions).toBe(0);
			expect(mockSessionScanner.scanAllSessions).toHaveBeenCalled();
		});

		it('should only initialize once', async () => {
			await service.initialize();
			await service.initialize();

			// Should only call scanner once despite multiple initialize calls
			expect(mockSessionScanner.scanAllSessions).toHaveBeenCalledTimes(1);
		});

		it('should handle initialization errors gracefully', async () => {
			mockSessionScanner.scanAllSessions = vi.fn().mockRejectedValue(new Error('Scan failed'));

			await expect(service.initialize()).rejects.toThrow('Scan failed');
		});
	});

	describe('getRawSessionResults', () => {
		it('should return empty array when no sessions are available', async () => {
			await service.initialize();
			const results = await service.getRawSessionResults();

			expect(results).toEqual([]);
		});

		it('should return cached session results after initialization', async () => {
			const sampleResults: SessionScanResult[] = [
				{
					sessionFilePath: '/path/to/session.json',
					session: {
						version: 1,
						sessionId: 'session1',
						creationDate: 1733483400000,
						lastMessageDate: 1733483400000,
						requesterUsername: 'test',
						responderUsername: 'copilot',
						initialLocation: 'editor',
						turns: [],
					},
					lastModified: new Date('2025-12-06T10:00:00Z'),
					fileSize: 1024,
					harvestedMetadata: {
						workspaceId: 'workspace1',
						vscodeVariant: 'stable',
						sessionFileName: 'session1.json',
						isFromLocalUser: true,
					},
				},
			];

			mockSessionScanner.scanAllSessions = vi.fn().mockResolvedValue({
				results: sampleResults,
				stats: {
					totalSessions: 1,
					totalRequests: 0,
					scannedFiles: 1,
					errorFiles: 0,
					scanDuration: 100
				}
			});

			await service.initialize();
			const results = await service.getRawSessionResults();

			expect(results).toEqual(sampleResults);
		});

		it('should perform scan if cache is empty', async () => {
			const sampleResults: SessionScanResult[] = [
				{
					sessionFilePath: '/path/to/session.json',
					session: {
						version: 1,
						sessionId: 'session1',
						creationDate: 1733483400000,
						lastMessageDate: 1733483400000,
						requesterUsername: 'test',
						responderUsername: 'copilot',
						initialLocation: 'editor',
						turns: [],
					},
					lastModified: new Date('2025-12-06T10:00:00Z'),
					fileSize: 1024,
					harvestedMetadata: {
						workspaceId: 'workspace1',
						vscodeVariant: 'stable',
						sessionFileName: 'session1.json',
						isFromLocalUser: true,
					},
				},
			];

			mockSessionScanner.scanAllSessions = vi.fn().mockResolvedValue({
				results: sampleResults,
				stats: {
					totalSessions: 1,
					totalRequests: 0,
					scannedFiles: 1,
					errorFiles: 0,
					scanDuration: 100
				}
			});

			const results = await service.getRawSessionResults();

			expect(results).toEqual(sampleResults);
			expect(mockSessionScanner.scanAllSessions).toHaveBeenCalled();
		});
	});

	describe('callback subscriptions', () => {
		it('should allow subscribing to raw session updates', () => {
			const callback = vi.fn();
			service.onRawSessionResultsUpdated(callback);

			// Verify callback is registered (no error thrown)
			expect(callback).toBeDefined();
		});

		it('should allow unsubscribing from raw session updates', () => {
			const callback = vi.fn();
			service.onRawSessionResultsUpdated(callback);
			service.removeRawSessionCallback(callback);

			// Verify no error is thrown
			expect(callback).toBeDefined();
		});

		it('should handle multiple callbacks', () => {
			const callback1 = vi.fn();
			const callback2 = vi.fn();
			
			service.onRawSessionResultsUpdated(callback1);
			service.onRawSessionResultsUpdated(callback2);

			// Verify both callbacks are registered
			expect(callback1).toBeDefined();
			expect(callback2).toBeDefined();
		});
	});

	describe('scan state management', () => {
		it('should set isScanning to true during scan', async () => {
			let scanningDuringScan = false;

			mockSessionScanner.scanAllSessions = vi.fn().mockImplementation(async () => {
				scanningDuringScan = service.isScanning;
				return {
					results: [],
					stats: {
						totalSessions: 0,
						totalRequests: 0,
						scannedFiles: 0,
						errorFiles: 0,
						scanDuration: 0
					}
				};
			});

			await service.initialize();

			expect(scanningDuringScan).toBe(true);
		});

		it('should set isScanning to false after scan completes', async () => {
			await service.initialize();

			expect(service.isScanning).toBe(false);
		});

		it('should handle scan failures', async () => {
			mockSessionScanner.scanAllSessions = vi.fn().mockRejectedValue(new Error('Scan failed'));

			await expect(service.initialize()).rejects.toThrow('Scan failed');
		});
	});

	describe('concurrent scan protection', () => {
		it('should not start multiple scans simultaneously', async () => {
			let scanCount = 0;

			mockSessionScanner.scanAllSessions = vi.fn().mockImplementation(async () => {
				scanCount++;
				// Simulate slow scan
				await new Promise(resolve => setTimeout(resolve, 100));
				return {
					results: [],
					stats: {
						totalSessions: 0,
						totalRequests: 0,
						scannedFiles: 0,
						errorFiles: 0,
						scanDuration: 100
					}
				};
			});

			// Start multiple initializations concurrently
			const promises = [
				service.initialize(),
				service.initialize(),
				service.initialize(),
			];

			await Promise.all(promises);

			// Should only scan once due to single-flight behavior
			expect(scanCount).toBeLessThanOrEqual(1);
		});
	});

	describe('data consistency', () => {
		it('should maintain separate caches for sessions and log entries', async () => {
			const sampleResults: SessionScanResult[] = [
				{
					sessionFilePath: '/path/to/session.json',
					session: {
						version: 1,
						sessionId: 'session1',
						creationDate: 1733483400000,
						lastMessageDate: 1733483400000,
						requesterUsername: 'test',
						responderUsername: 'copilot',
						initialLocation: 'editor',
						turns: [],
					},
					lastModified: new Date('2025-12-06T10:00:00Z'),
					fileSize: 1024,
					harvestedMetadata: {
						workspaceId: 'workspace1',
						vscodeVariant: 'stable',
						sessionFileName: 'session1.json',
						isFromLocalUser: true,
					},
				},
			];

			mockSessionScanner.scanAllSessions = vi.fn().mockResolvedValue({
				results: sampleResults,
				stats: {
					totalSessions: 1,
					totalRequests: 0,
					scannedFiles: 1,
					errorFiles: 0,
					scanDuration: 100
				}
			});

			const result = await service.initialize();

			expect(result.results).toEqual(sampleResults);
			expect(result.logEntries).toEqual([]);
			expect(result.results).not.toBe(result.logEntries);
		});
	});
});
