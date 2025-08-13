/**
 * Shared type definitions for log scanning components
 */

export interface LogEntry {
	timestamp: Date;
	level: string;
	requestId: string;
	modelName: string;
	responseTime: number;
	status: 'success' | 'error';
	rawLine: string;
	finishReason?: string; // From multi-line parsing
	context?: string; // From multi-line parsing
	ccreqId?: string; // From multi-line parsing
}

export interface GlobalLogScanResult {
	logEntries: LogEntry[];
	scope: 'global';
	metadata: {
		vscodeVersion: string;
		sessionId: string;
		windowId: string;
		totalInstancesScanned: number;
		scanStartTime: string;
		scanEndTime: string;
	};
}

export interface WindowLogScanResult {
	logEntries: LogEntry[];
	scope: 'window';
	metadata: {
		windowId: string;
		isBackfill: boolean; // true for initial full read, false for real-time
		filePosition: number;
		logFilePath: string;
	};
}

export interface LogScanResult {
	logEntries: LogEntry[];
}
