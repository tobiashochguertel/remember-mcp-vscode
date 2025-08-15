/**
 * Type definitions for VS Code Chat Session files
 * Based on the actual structure found in chatSessions directories
 */

export interface CopilotChatSession {
	version: number;
	sessionId: string;
	creationDate: number; // Unix timestamp
	lastMessageDate: number; // Unix timestamp
	requesterUsername: string;
	responderUsername: string;
	initialLocation: string;
	isImported?: boolean;
	requests: CopilotChatRequest[];
	// Optional: sequence of edit state requestIds (if edit state timelines scanned & matched by sessionId)
	editStateRequestIds?: string[];
}

/**
 * Individual tool call within a tool call round
 */
export interface ToolCall {
	id: string;
	name: string;                  // Function name (directly on toolCall, not nested)
	arguments: string;             // JSON string of arguments
	[key: string]: any;           // Allow for additional fields
}

/**
 * A single round of tool calling - represents one backend LLM invocation
 */
export interface ToolCallRound {
	id: string;                    // Unique identifier for this round
	response: string;              // The actual response text from the LLM
	toolCalls: ToolCall[];         // Array of tool calls (empty for synthesis rounds)
	toolInputRetry: number;        // Number of retry attempts
	[key: string]: any;           // Allow for additional fields
}

/**
 * Enhanced metadata structure that properly captures toolCallRounds
 */
export interface RequestMetadata {
	toolCallRounds: ToolCallRound[];      // THE CRITICAL FIELD - sequence of LLM calls
	codeBlocks?: any[];                   // Code blocks in the response
	renderedUserMessage?: any[];          // Rendered user message parts
	renderedGlobalContext?: any[];        // Global context information
	modelMessageId?: string;              // Message ID from the model
	responseId?: string;                  // Response ID
	sessionId?: string;                   // Session ID
	agentId?: string;                     // Agent ID that handled the request
	[key: string]: any;                   // Allow for additional metadata fields
}

export interface CopilotChatRequest {
	requestId: string;
	responseId: string;
	timestamp: number; // Unix timestamp
	modelId?: string; // Optional - not all requests have a modelId
	isCanceled: boolean;
	
	// NEW: modes array present in newer session files (e.g., ["ask"], ["edit"], etc.)
	modes?: string[];
	    
	// User message
	message: {
		text: string;
		parts: Array<{
			[key: string]: any;
		}>;
	};
    
	// Variable data
	variableData?: {
		variables: Array<{
			[key: string]: any;
		}>;
	};
    
	// Agent information (optional - slash commands like /clear don't have an agent)
	agent?: {
		id: string;                    // e.g., "github.copilot.editsAgent"
		name: string;                  // e.g., "agent"
		extensionId: string;           // e.g., "github.copilot"
		extensionDisplayName?: string;
		publisherDisplayName?: string;
		description?: string;
		fullName?: string;
		isDefault?: boolean;
		[key: string]: any;
	};
    
	// Response content
	response: Array<{
		value: string;
		kind?: string;
		[key: string]: any;
	}>;
    
	// Performance metrics and metadata (ENHANCED TO CAPTURE TOOLCALLROUNDS)
	result?: {
		timings?: {
			totalElapsed: number;
			firstProgress: number;
		};
		metadata?: RequestMetadata;    // Enhanced metadata with toolCallRounds
		[key: string]: any;
	};
    
	// Context and references
	contentReferences?: Array<{
		reference: {
			uri?: string;  // May not always be present
			fsPath?: string;  // Windows file system path
			path?: string;  // Unix-style path
			external?: string;  // External URI reference
			scheme?: string;  // URI scheme (e.g., "file", "vscode-userdata")
			$mid?: number;  // VS Code internal identifier
			_sep?: number;  // VS Code internal separator
			range?: {
				start: { line: number; character: number };
				end: { line: number; character: number };
			};
		};
		kind?: string;  // Reference kind (e.g., "reference")
		[key: string]: any;
	}>;
    
	codeCitations?: Array<{
		license: string;
		snippet: string;
		[key: string]: any;
	}>;
    
	followups?: Array<{
		message: string;
		[key: string]: any;
	}>;
}

export interface SessionScanResult {
	sessionFilePath: string;
	session: CopilotChatSession;
	lastModified: Date;
	fileSize: number;
}

export interface SessionScanStats {
	totalSessions: number;
	totalRequests: number;
	scannedFiles: number;
	errorFiles: number;
	scanDuration: number;
	oldestSession?: string;
	newestSession?: string;
}

export interface SessionWatcherOptions {
	enableWatching: boolean;
	debounceMs: number;
	maxRetries: number;
}

export interface SessionMetadata {
	sessionId: string;
	workspaceHash: string;
	vscodeInstanceId: string;
	sessionStartTime: string;
	sessionEndTime?: string;
	requestCount: number;
	totalResponseLength: number;
	averageResponseTime: number;
	languagesUsed: string[];
	modelsUsed: string[];
	hasCodeCitations: boolean;
	hasContentReferences: boolean;
	hasFollowups: boolean;
}

// Constants for session scanning
export const SESSION_SCAN_CONSTANTS = {
	// VS Code storage paths
	VSCODE_STORAGE_PATHS: [
		'AppData/Roaming/Code/User/workspaceStorage',
		'AppData/Roaming/Code - Insiders/User/workspaceStorage'
	],
    
	// Chat session directory name
	CHAT_SESSIONS_DIR: 'chatSessions',
    
	// File patterns
	SESSION_FILE_PATTERN: /^[a-f0-9-]+\.json$/,
        
	// Debounce settings
	DEFAULT_DEBOUNCE_MS: 500,
    
	// Retry settings
	DEFAULT_MAX_RETRIES: 3
} as const;
