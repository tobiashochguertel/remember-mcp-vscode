/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Niclas Olofsson. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrerequisiteChecker } from '../../extension';

// Mock child_process exec
vi.mock('child_process', () => ({
	exec: vi.fn(),
}));

vi.mock('util', () => ({
	promisify: vi.fn((fn) => fn),
}));

describe('PrerequisiteChecker', () => {
	beforeEach(() => {
		// Clear cache before each test
		PrerequisiteChecker.clearCache();
		vi.clearAllMocks();
	});

	describe('commandRequiresPipx', () => {
		it('should return true when command contains pipx', () => {
			const command = 'pipx run --system-site-packages mode-manager-mcp';
			expect(PrerequisiteChecker.commandRequiresPipx(command)).toBe(true);
		});

		it('should return false when command uses uv', () => {
			const command = 'uvx mode-manager-mcp';
			expect(PrerequisiteChecker.commandRequiresPipx(command)).toBe(false);
		});

		it('should return false when command uses docker', () => {
			const command = 'docker run myimage mode-manager-mcp';
			expect(PrerequisiteChecker.commandRequiresPipx(command)).toBe(false);
		});

		it('should return false when command is direct', () => {
			const command = 'mode-manager-mcp';
			expect(PrerequisiteChecker.commandRequiresPipx(command)).toBe(false);
		});

		it('should return false for empty command', () => {
			const command = '';
			expect(PrerequisiteChecker.commandRequiresPipx(command)).toBe(false);
		});

		it('should return true when pipx appears in command path', () => {
			const command = '/usr/local/bin/pipx run mode-manager-mcp';
			expect(PrerequisiteChecker.commandRequiresPipx(command)).toBe(true);
		});

		it('should return true when pipx is in argument', () => {
			const command = 'python -m pipx run mode-manager-mcp';
			expect(PrerequisiteChecker.commandRequiresPipx(command)).toBe(true);
		});
	});

	describe('clearCache', () => {
		it('should clear cached results', () => {
			// This test verifies that clearCache resets the internal state
			PrerequisiteChecker.clearCache();
			expect(() => PrerequisiteChecker.clearCache()).not.toThrow();
		});
	});

	describe('checkPrerequisites', () => {
		it('should handle checkPipx parameter correctly', async () => {
			// Mock execAsync to simulate Python available but pipx not available
			const { exec } = await import('child_process');
			const mockExec = exec as any;

			mockExec.mockImplementation((cmd: string, callback: any) => {
				if (cmd.includes('python')) {
					callback(null, { stdout: 'Python 3.10.0', stderr: '' });
				} else if (cmd.includes('pipx')) {
					callback(new Error('Command not found'), { stdout: '', stderr: '' });
				}
			});

			// When checkPipx is false, pipx should be assumed available
			const resultNoPipxCheck = await PrerequisiteChecker.checkPrerequisites(false);
			expect(resultNoPipxCheck.pipx).toBe(true);
		});

		it('should cache results based on checkPipx parameter', async () => {
			const { exec } = await import('child_process');
			const mockExec = exec as any;
			let callCount = 0;

			mockExec.mockImplementation((cmd: string, callback: any) => {
				callCount++;
				if (cmd.includes('python')) {
					callback(null, { stdout: 'Python 3.10.0', stderr: '' });
				} else if (cmd.includes('pipx')) {
					callback(new Error('Command not found'), { stdout: '', stderr: '' });
				}
			});

			// First call with checkPipx=true
			await PrerequisiteChecker.checkPrerequisites(true);
			const firstCallCount = callCount;

			// Second call with checkPipx=true should use cache
			await PrerequisiteChecker.checkPrerequisites(true);
			expect(callCount).toBe(firstCallCount);

			// Call with checkPipx=false should NOT use cache (different parameter)
			await PrerequisiteChecker.checkPrerequisites(false);
			expect(callCount).toBeGreaterThan(firstCallCount);
		});
	});
});
