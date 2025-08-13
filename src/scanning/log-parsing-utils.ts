/**
 * Shared utility functions for parsing VS Code Copilot logs
 * 
 * These are pure utility functions with no event logic - just data processing.
 * Used by both GlobalLogScanner and WindowLogWatcher.
 */

import * as fs from 'fs/promises';
import { LogEntry } from './log-types';

export class LogParsingUtils {
	// Multi-line pattern to capture 3-line request sequences:
	// Line 1: message X returned. finish reason: [reason]
	// Line 2: request done: requestId: [id] model deployment ID: [id]
	// Line 3: ccreq:id | status | model | duration | [context]
	// Uses flexible datetime matching instead of rigid format
	private static readonly MULTILINE_REQUEST_PATTERN = new RegExp(
		// Line 1: message returned with finish reason
		'([^\\[]+)\\s*\\[info\\] message \\d+ returned\\. finish reason: \\[([^\\]]+)\\]\\s*' +
		// Line 2: request done with requestId
		'([^\\[]+)\\s*\\[info\\] request done: requestId: \\[([^\\]]+)\\] model deployment ID: \\[([^\\]]*)\\]\\s*' +
		// Line 3: ccreq with model info
		'([^\\[]+)\\s*\\[info\\] ccreq:([^|.\\s]+)(?:\\.copilotmd)?\\s*\\|\\s*([^|]+)\\s*\\|\\s*([^|]+)\\s*\\|\\s*([^|]+)\\s*\\|\\s*\\[([^\\]]+)\\]',
		'g'
	);

	/**
	 * Parse timestamp from VS Code log format
	 * Currently handles: "2025-08-10 15:15:27.396" format  
	 * Returns a proper Date object. Can be extended for other datetime formats as needed.
	 */
	static parseTimestamp(timestampStr: string): Date {
		// Trim any whitespace from the captured datetime string
		const cleanTimestamp = timestampStr.trim();

		// The current format is: YYYY-MM-DD HH:mm:ss.SSS
		// Convert to ISO format by adding 'T' and 'Z': YYYY-MM-DDTHH:mm:ss.SSSZ
		const isoString = cleanTimestamp.replace(' ', 'T') + 'Z';
		return new Date(isoString);
	}

	/**
	 * Parse multi-line request sequences from log content
	 * Captures 3-line patterns: finish reason, request done, ccreq info
	 */
	static parseMultiLineRequests(content: string): LogEntry[] {
		const entries: LogEntry[] = [];

		let match;
		while ((match = LogParsingUtils.MULTILINE_REQUEST_PATTERN.exec(content)) !== null) {
			const [
				fullMatch,
				_timestamp1, finishReason,
				_timestamp2, requestId, _modelDeploymentId,
				timestamp3, ccreqId, status, modelName, duration, context
			] = match;

			try {
				// Use the latest timestamp (from ccreq line)
				const parsedTimestamp = LogParsingUtils.parseTimestamp(timestamp3);

				// Extract response time from duration string (e.g., "12862ms")
				const timingMatch = duration.match(/(\d+)ms/);
				const responseTime = timingMatch ? parseInt(timingMatch[1], 10) : 0;

				const entry: LogEntry = {
					timestamp: parsedTimestamp,
					level: 'info',
					requestId: requestId.trim(),
					modelName: modelName.trim(),
					responseTime,
					status: status.trim() === 'error' ? 'error' : 'success',
					rawLine: fullMatch, // Store the complete 3-line match
					finishReason: finishReason.trim(),
					context: context.trim(),
					ccreqId: ccreqId.trim()
				};

				entries.push(entry);
			} catch (error) {
				// Log parsing error - skip this entry
				console.error(`Error parsing multi-line match: ${error}`);
			}
		}

		return entries;
	}

	/**
	 * Read the entire content of a file
	 */
	static async readFileContent(filePath: string): Promise<string> {
		try {
			const buffer = await fs.readFile(filePath);
			return buffer.toString('utf-8');
		} catch (error) {
			throw new Error(`Failed to read file ${filePath}: ${error}`);
		}
	}

	/**
	 * Read only new content from a file since the last position
	 */
	static async readNewContent(filePath: string, lastPosition: number): Promise<{ content: string; newPosition: number }> {
		try {
			const stats = await fs.stat(filePath);

			// If file was truncated or is smaller than last position, reset
			if (stats.size < lastPosition) {
				lastPosition = 0;
			}

			// If no new content, return empty
			if (stats.size <= lastPosition) {
				return { content: '', newPosition: lastPosition };
			}

			// Read only the new content
			const fd = await fs.open(filePath, 'r');
			const newContentSize = stats.size - lastPosition;
			const buffer = Buffer.alloc(newContentSize);

			await fd.read(buffer, 0, newContentSize, lastPosition);
			await fd.close();

			const newContent = buffer.toString('utf-8');
			return { content: newContent, newPosition: stats.size };
		} catch (error) {
			throw new Error(`Failed to read new content from ${filePath}: ${error}`);
		}
	}

	/**
	 * Get current file size for position tracking
	 */
	static async getFileSize(filePath: string): Promise<number> {
		try {
			const stats = await fs.stat(filePath);
			return stats.size;
		} catch (error) {
			throw new Error(`Failed to get file size for ${filePath}: ${error}`);
		}
	}
}
