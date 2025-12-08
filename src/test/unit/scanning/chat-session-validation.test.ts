/**
 * Tests for chat session validation with real fixture data
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { CopilotChatSession } from '../../../types/chat-session';

describe('ChatSession Validation with Test Fixtures', () => {
	const fixturesDir = path.join(__dirname, '../../fixtures/sessions');
	
	const testFixtures = [
		'629259ad-e862-43f4-be6e-9b8ad29fbcf7.json',
		'91ede0c5-353c-4c80-a5b0-38f09b4e6f95.json',
		'c4416ab6-bfc3-4ce6-8f61-40a81f263653.json',
		'eeb47841-92fe-489e-a784-2f1e467b6956.json',
		'f68e0cba-74ec-4bed-8256-b58925a6f40d.json',
		'fc55e2d4-ff6b-48b0-beaf-1de7604259fa.json'
	];

	describe('Field Name Mapping', () => {
		it.each(testFixtures)('should have "requests" array in %s', async (filename) => {
			const filePath = path.join(fixturesDir, filename);
			const content = await fs.readFile(filePath, 'utf-8');
			const rawSession = JSON.parse(content);
			
			expect(rawSession).toHaveProperty('requests');
			expect(Array.isArray(rawSession.requests)).toBe(true);
		});

		it.each(testFixtures)('should map "requests" to "turns" in %s', async (filename) => {
			const filePath = path.join(fixturesDir, filename);
			const content = await fs.readFile(filePath, 'utf-8');
			const rawSession = JSON.parse(content);
			
			// Simulate the mapping done in chat-session-scanner.ts
			const session: CopilotChatSession = {
				...rawSession,
				turns: rawSession.requests || []
			};
			delete (session as any).requests;
			
			expect(session).toHaveProperty('turns');
			expect(Array.isArray(session.turns)).toBe(true);
			expect(session.turns.length).toBeGreaterThan(0);
		});

		it.each(testFixtures)('should have requestId (not turnId) in requests of %s', async (filename) => {
			const filePath = path.join(fixturesDir, filename);
			const content = await fs.readFile(filePath, 'utf-8');
			const rawSession = JSON.parse(content);
			
			expect(rawSession.requests[0]).toHaveProperty('requestId');
			expect(rawSession.requests[0]).not.toHaveProperty('turnId');
		});
	});

	describe('Session Structure Validation', () => {
		it.each(testFixtures)('should have valid session structure in %s', async (filename) => {
			const filePath = path.join(fixturesDir, filename);
			const content = await fs.readFile(filePath, 'utf-8');
			const rawSession = JSON.parse(content);
			
			// Map to our interface
			const session: CopilotChatSession = {
				...rawSession,
				turns: rawSession.requests || []
			};
			delete (session as any).requests;
			
			// Validate required fields
			expect(session.version).toBeTypeOf('number');
			expect(session.sessionId).toBeTypeOf('string');
			expect(session.creationDate).toBeTypeOf('number');
			expect(session.lastMessageDate).toBeTypeOf('number');
			expect(session.requesterUsername).toBeTypeOf('string');
			expect(session.responderUsername).toBeTypeOf('string');
			expect(session.initialLocation).toBeTypeOf('string');
			expect(Array.isArray(session.turns)).toBe(true);
			
			// Validate turn structure
			for (const turn of session.turns) {
				expect(turn.requestId).toBeTypeOf('string');
				expect(turn.responseId).toBeTypeOf('string');
				expect(turn.timestamp).toBeTypeOf('number');
				expect(turn.isCanceled).toBeTypeOf('boolean');
				expect(turn.message).toBeDefined();
				expect(turn.message.text).toBeTypeOf('string');
			}
		});
	});
});
