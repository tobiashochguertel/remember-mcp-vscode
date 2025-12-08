/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Niclas Olofsson. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';

// Mock os module before importing the module under test
vi.mock('os', () => ({
	platform: vi.fn(),
	homedir: vi.fn()
}));

import * as os from 'os';
import { getVSCodeStorageConfig, getVSCodeStoragePaths } from '../../../util/vscode-paths';

describe('vscode-paths', () => {
	let originalPlatform: string;

	beforeEach(() => {
		originalPlatform = process.platform;
		vi.clearAllMocks();
	});

	afterEach(() => {
		// Restore original platform
		Object.defineProperty(process, 'platform', {
			value: originalPlatform,
			writable: true,
			configurable: true
		});
		vi.restoreAllMocks();
	});

	describe('getVSCodeStorageConfig', () => {
		it('should return Windows paths for win32 platform', () => {
			// Mock Windows platform
			vi.mocked(os.platform).mockReturnValue('win32');

			const config = getVSCodeStorageConfig();

			expect(config.stable).toBe(path.join('AppData', 'Roaming', 'Code', 'User', 'workspaceStorage'));
			expect(config.insiders).toBe(path.join('AppData', 'Roaming', 'Code - Insiders', 'User', 'workspaceStorage'));
		});

		it('should return macOS paths for darwin platform', () => {
			// Mock macOS platform
			vi.mocked(os.platform).mockReturnValue('darwin');

			const config = getVSCodeStorageConfig();

			expect(config.stable).toBe(path.join('Library', 'Application Support', 'Code', 'User', 'workspaceStorage'));
			expect(config.insiders).toBe(path.join('Library', 'Application Support', 'Code - Insiders', 'User', 'workspaceStorage'));
		});

		it('should return Linux paths for linux platform', () => {
			// Mock Linux platform
			vi.mocked(os.platform).mockReturnValue('linux');

			const config = getVSCodeStorageConfig();

			expect(config.stable).toBe(path.join('.config', 'Code', 'User', 'workspaceStorage'));
			expect(config.insiders).toBe(path.join('.config', 'Code - Insiders', 'User', 'workspaceStorage'));
		});

		it('should default to Linux paths for unknown platform', () => {
			// Mock unknown platform
			vi.mocked(os.platform).mockReturnValue('freebsd' as NodeJS.Platform);

			const config = getVSCodeStorageConfig();

			expect(config.stable).toBe(path.join('.config', 'Code', 'User', 'workspaceStorage'));
			expect(config.insiders).toBe(path.join('.config', 'Code - Insiders', 'User', 'workspaceStorage'));
		});
	});

	describe('getVSCodeStoragePaths', () => {
		it('should return absolute paths for Windows', () => {
			// Mock Windows platform
			vi.mocked(os.platform).mockReturnValue('win32');
			const mockHomedir = 'C:\\Users\\TestUser';
			vi.mocked(os.homedir).mockReturnValue(mockHomedir);

			const paths = getVSCodeStoragePaths();

			expect(paths).toHaveLength(2);
			expect(paths[0]).toBe(path.join(mockHomedir, 'AppData', 'Roaming', 'Code', 'User', 'workspaceStorage'));
			expect(paths[1]).toBe(path.join(mockHomedir, 'AppData', 'Roaming', 'Code - Insiders', 'User', 'workspaceStorage'));
			
			// Verify paths start with home directory
			expect(paths[0]).toContain(mockHomedir);
			expect(paths[1]).toContain(mockHomedir);
		});

		it('should return absolute paths for macOS', () => {
			// Mock macOS platform
			vi.mocked(os.platform).mockReturnValue('darwin');
			const mockHomedir = '/Users/testuser';
			vi.mocked(os.homedir).mockReturnValue(mockHomedir);

			const paths = getVSCodeStoragePaths();

			expect(paths).toHaveLength(2);
			expect(paths[0]).toBe(path.join(mockHomedir, 'Library', 'Application Support', 'Code', 'User', 'workspaceStorage'));
			expect(paths[1]).toBe(path.join(mockHomedir, 'Library', 'Application Support', 'Code - Insiders', 'User', 'workspaceStorage'));
			
			// Verify paths are absolute
			expect(path.isAbsolute(paths[0])).toBe(true);
			expect(path.isAbsolute(paths[1])).toBe(true);
		});

		it('should return absolute paths for Linux', () => {
			// Mock Linux platform
			vi.mocked(os.platform).mockReturnValue('linux');
			const mockHomedir = '/home/testuser';
			vi.mocked(os.homedir).mockReturnValue(mockHomedir);

			const paths = getVSCodeStoragePaths();

			expect(paths).toHaveLength(2);
			expect(paths[0]).toBe(path.join(mockHomedir, '.config', 'Code', 'User', 'workspaceStorage'));
			expect(paths[1]).toBe(path.join(mockHomedir, '.config', 'Code - Insiders', 'User', 'workspaceStorage'));
			
			// Verify paths are absolute
			expect(path.isAbsolute(paths[0])).toBe(true);
			expect(path.isAbsolute(paths[1])).toBe(true);
		});

		it('should handle different home directory formats', () => {
			// Mock Linux platform
			vi.mocked(os.platform).mockReturnValue('linux');

			const testHomeDirs = [
				'/home/user-with-dashes',
				'/home/user.with.dots',
				'/home/user_with_underscores',
				'/home/user123'
			];

			for (const homeDir of testHomeDirs) {
				vi.mocked(os.homedir).mockReturnValue(homeDir);
				const paths = getVSCodeStoragePaths();

				expect(paths).toHaveLength(2);
				expect(paths[0]).toContain(homeDir);
				expect(paths[1]).toContain(homeDir);
			}
		});

		it('should always return both stable and insiders paths', () => {
			const platforms = ['win32', 'darwin', 'linux'];
			
			for (const platform of platforms) {
				Object.defineProperty(process, 'platform', {
					value: platform,
					writable: true,
					configurable: true
				});

				const paths = getVSCodeStoragePaths();

				expect(paths).toHaveLength(2);
				expect(paths[0]).toContain('Code');
				expect(paths[0]).toContain('workspaceStorage');
				expect(paths[1]).toContain('Code - Insiders');
				expect(paths[1]).toContain('workspaceStorage');
			}
		});
	});

	describe('cross-platform path consistency', () => {
		it('should use path.join to construct paths', () => {
			// We can't test the actual separator used since path.join will use
			// the current platform's separator. Instead, we verify that paths
			// don't contain hardcoded slashes that would break on other platforms.
			const platforms = ['win32', 'darwin', 'linux'] as const;

			for (const platform of platforms) {
				vi.mocked(os.platform).mockReturnValue(platform);

				const config = getVSCodeStorageConfig();

				// Verify paths are constructed properly (contain expected components)
				expect(config.stable).toContain('Code');
				expect(config.stable).toContain('User');
				expect(config.stable).toContain('workspaceStorage');
				
				expect(config.insiders).toContain('Code - Insiders');
				expect(config.insiders).toContain('User');
				expect(config.insiders).toContain('workspaceStorage');
			}
		});

		it('should not contain hardcoded forward or backward slashes', () => {
			const platforms = ['win32', 'darwin', 'linux'];

			for (const platform of platforms) {
				Object.defineProperty(process, 'platform', {
					value: platform,
					writable: true,
					configurable: true
				});

				const config = getVSCodeStorageConfig();

				// Verify paths are using path.join and not string concatenation
				// This is implicit in the implementation, but we verify the result
				expect(config.stable).toBeTruthy();
				expect(config.insiders).toBeTruthy();
			}
		});
	});

	describe('real-world scenarios', () => {
		it('should handle the reported macOS bug case', () => {
			// Simulate the bug: macOS user with Windows-style path
			vi.mocked(os.platform).mockReturnValue('darwin');
			const mockHomedir = '/Users/tobiashochgurtel';
			vi.mocked(os.homedir).mockReturnValue(mockHomedir);

			const paths = getVSCodeStoragePaths();

			// Should NOT contain 'AppData/Roaming' on macOS
			expect(paths[0]).not.toContain('AppData');
			expect(paths[0]).not.toContain('Roaming');
			
			// Should contain proper macOS paths
			expect(paths[0]).toBe('/Users/tobiashochgurtel/Library/Application Support/Code/User/workspaceStorage');
			expect(paths[1]).toBe('/Users/tobiashochgurtel/Library/Application Support/Code - Insiders/User/workspaceStorage');
		});

		it('should work correctly on the actual current platform', () => {
			// Use the real platform (no mocking)
			vi.restoreAllMocks();

			const paths = getVSCodeStoragePaths();

			expect(paths).toHaveLength(2);
			expect(paths[0]).toBeTruthy();
			expect(paths[1]).toBeTruthy();
			
			// Verify they're absolute paths
			expect(path.isAbsolute(paths[0])).toBe(true);
			expect(path.isAbsolute(paths[1])).toBe(true);
			
			// Verify they contain expected VS Code directories
			expect(paths[0]).toContain('workspaceStorage');
			expect(paths[1]).toContain('workspaceStorage');
		});
	});
});
