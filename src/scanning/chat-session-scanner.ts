/**
 * Chat Session Scanner - Discovers and monitors VS Code chat session files
 * Replaces log parsing with direct session file access
 */

import * as vscode from 'vscode';
import { ForceFileWatcher } from '../util/force-file-watcher';
import * as fsPromises from 'fs/promises';
import type * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { 
	CopilotChatSession, 
	SessionScanResult, 
	SessionScanStats, 
	SESSION_SCAN_CONSTANTS 
} from '../types/chat-session';
import { ILogger } from '../types/logger';

export class ChatSessionScanner {
	private fileWatcher?: ForceFileWatcher;
	private sessionWatchers: ForceFileWatcher[] = [];
	private watcherCallbacks: Array<(result: SessionScanResult) => void> = [];
	private isWatching = false;
	private lastUsedStoragePaths: string[] = [];
	// Track last known file sizes to avoid re-parsing unchanged files
	private fileSizes: Map<string, number> = new Map();
    
	constructor(
		private readonly storagePaths: string[],
		private readonly logger: ILogger
	) {
		this.lastUsedStoragePaths = [...storagePaths];
	}

	/**
     * Find all chat session files across VS Code storage locations
     */
	private async findAllChatSessionFiles(): Promise<string[]> {
		this.logger.info('Starting comprehensive session file scan...');
        
		const allFiles: string[] = [];
        
		for (const basePath of this.storagePaths) {
			try {
				this.logger.info(`Scanning ${basePath}...`);

				const files = await this.scanStorageLocation(basePath);
				allFiles.push(...files);
				this.logger.debug(`Found ${files.length} session files in ${basePath}`);
			} catch (error) {
				this.logger.error(`Error scanning ${basePath}: ${error}`);
			}
		}
        
		this.logger.info(`Total session files found: ${allFiles.length}`);
		return allFiles;
	}

	/**
     * Scan a specific VS Code storage location for chat session files
     */
	private async scanStorageLocation(storagePath: string): Promise<string[]> {
		const sessionFiles: string[] = [];
        
		try {
			// Check if storage path exists
			await fsPromises.access(storagePath);
            
			// Read workspace directories
			const workspaceDirs = await fsPromises.readdir(storagePath, { withFileTypes: true });
            
			for (const workspaceDir of workspaceDirs) {
				if (!workspaceDir.isDirectory()) {
					continue;
				}
                
				const chatSessionsPath = path.join(storagePath, workspaceDir.name, SESSION_SCAN_CONSTANTS.CHAT_SESSIONS_DIR);
                
				try {
					await fsPromises.access(chatSessionsPath);
					const sessionFiles_local = await this.scanChatSessionsDirectory(chatSessionsPath);
					sessionFiles.push(...sessionFiles_local);
				} catch {
					// chatSessions directory doesn't exist in this workspace
					continue;
				}
			}
		} catch (error) {
			this.logger.error(`Error accessing storage location ${storagePath}: ${error}`);
			throw new Error(`Failed to scan storage location ${storagePath}: ${error}`);
		}
        
		return sessionFiles;
	}

	/**
     * Scan a specific chatSessions directory for JSON files
     */
	private async scanChatSessionsDirectory(chatSessionsPath: string): Promise<string[]> {
		const sessionFiles: string[] = [];
        
		try {
			const files = await fsPromises.readdir(chatSessionsPath);
            
			for (const fileName of files) {
				// Check if file matches session pattern
				if (!SESSION_SCAN_CONSTANTS.SESSION_FILE_PATTERN.test(fileName)) {
					continue;
				}
                
				const filePath = path.join(chatSessionsPath, fileName);
                
				try {
					sessionFiles.push(filePath);
				} catch (error) {
					this.logger.error(`Error checking file ${filePath}: ${error}`);
				}
			}
		} catch (error) {
			this.logger.error(`Failed to read chatSessions directory ${chatSessionsPath}: ${error}`);
			throw new Error(`Failed to read chatSessions directory ${chatSessionsPath}: ${error}`);
		}
        
		return sessionFiles;
	}

	/**
	 * Extract metadata from session file path that isn't available in session JSON
	 * Path format: .../[Code|Code - Insiders]/User/workspaceStorage/[WORKSPACE_ID]/chatSessions/[SESSION_ID].json
	 */
	private extractHarvestedMetadata(filePath: string): SessionScanResult['harvestedMetadata'] {
		const normalizedPath = path.normalize(filePath);
		const sessionFileName = path.basename(filePath);
		
		// Extract workspace ID from path pattern
		const workspaceStorageMatch = normalizedPath.match(/workspaceStorage[/\\]([a-f0-9]+)[/\\]chatSessions/i);
		const workspaceId = workspaceStorageMatch ? workspaceStorageMatch[1] : 'unknown';
		
		// Detect VS Code variant from path
		let vscodeVariant: 'stable' | 'insiders' | 'unknown' = 'unknown';
		if (normalizedPath.includes('Code - Insiders')) {
			vscodeVariant = 'insiders';
		} else if (normalizedPath.includes('Code') && !normalizedPath.includes('Code - Insiders')) {
			vscodeVariant = 'stable';
		}
		
		// Check if path contains current user directory
		const currentUser = os.userInfo().username;
		const isFromLocalUser = normalizedPath.includes(currentUser);
		
		return {
			workspaceId,
			vscodeVariant,
			sessionFileName,
			isFromLocalUser
		};
	}

	/**
     * Parse a single session file and return structured data
     */
	private async parseSessionFile(filePath: string): Promise<SessionScanResult | null> {
		try {
			// Get file stats
			const stats = await fsPromises.stat(filePath);
            
			// Read and parse file content
			const content = await fsPromises.readFile(filePath, 'utf-8');
			const rawSession = JSON.parse(content);
			
			// Map 'requests' field to 'turns' to match our interface
			const session: CopilotChatSession = {
				...rawSession,
				turns: rawSession.requests || []
			};
			delete (session as any).requests; // Remove the original field
            
			// Validate session structure
			if (!this.isValidSession(session)) {
				this.logger.error(`Invalid session structure in ${filePath}`);
				return null;
			}
            
			const result: SessionScanResult = {
				sessionFilePath: filePath,
				session,
				lastModified: stats.mtime,
				fileSize: stats.size,
				harvestedMetadata: this.extractHarvestedMetadata(filePath)
			};
            
			// Log the result structure for debugging
			this.logger.debug(`Created SessionScanResult with sessionFilePath: "${result.sessionFilePath}" (type: ${typeof result.sessionFilePath})`);
            
			return result;
		} catch (error) {
			this.logger.error(`Error parsing session file ${filePath}: ${error}`);
			return null;
		}
	}

	/**
     * Scan all session files and return parsed results
     */
	async scanAllSessions(): Promise<{ results: SessionScanResult[]; stats: SessionScanStats }> {
		const startTime = Date.now();
        
		this.logger.info('Starting full session scan...');
        
		const allFiles = await this.findAllChatSessionFiles();
		const results: SessionScanResult[] = [];
		let errorFiles = 0;
		let totalRequests = 0;
		let oldestSession: string | undefined;
		let newestSession: string | undefined;
        
		// Process files in batches to avoid memory issues
		const batchSize = 50;
		for (let i = 0; i < allFiles.length; i += batchSize) {
			const batch = allFiles.slice(i, i + batchSize);
            
			const batchPromises = batch.map(async (filePath) => {
				const result = await this.parseSessionFile(filePath);
				if (result) {
					totalRequests += result.session.turns.length;
                    
					// Track oldest/newest sessions (convert to ISO string for comparison)
					const sessionDate = new Date(result.session.creationDate).toISOString();
					if (!oldestSession || sessionDate < oldestSession) {
						oldestSession = sessionDate;
					}
					if (!newestSession || sessionDate > newestSession) {
						newestSession = sessionDate;
					}
                    
					return result;
				} else {
					errorFiles++;
					return null;
				}
			});
            
			const batchResults = await Promise.all(batchPromises);
			results.push(...batchResults.filter(r => r !== null) as SessionScanResult[]);
            
			// Progress reporting
			if (allFiles.length > 100 && i % 100 === 0) {
				this.logger.debug(`Processed ${i + batchSize}/${allFiles.length} files...`);
			}
		}
        
		const scanDuration = Date.now() - startTime;
        
		const stats: SessionScanStats = {
			totalSessions: results.length,
			totalRequests,
			scannedFiles: allFiles.length,
			errorFiles,
			scanDuration,
			oldestSession,
			newestSession
		};
        
		this.logger.info(`Scan complete: ${results.length} sessions, ${totalRequests} requests in ${scanDuration}ms`);
        
		return { results, stats };
	}

	/**
     * Start watching for new/modified session files
     */
	startWatching(callback: (result: SessionScanResult) => void): void {
		if (this.isWatching) {
			return;
		}
        
		this.watcherCallbacks.push(callback);
        
		if (this.watcherCallbacks.length === 1) {
			this.setupFileWatcher();
		}
        
		this.isWatching = true;
		this.logger.info('Started watching for session file changes');
	}

	/**
     * Stop watching for session file changes
     */
	stopWatching(): void {
		if (!this.isWatching) {
			return;
		}
        
		this.watcherCallbacks = [];
        
		if (this.fileWatcher) {
			this.fileWatcher.dispose();
			this.fileWatcher = undefined;
		}
		
		// Cleanup all session watchers
		for (const watcher of this.sessionWatchers) {
			try {
				watcher.dispose();
			} catch (error) {
				this.logger.error(`Error disposing session watcher: ${error}`);
			}
		}
		this.sessionWatchers = [];
        
		this.isWatching = false;
		this.logger.info('Stopped watching for session file changes');
	}

	/**
     * Setup file system watcher for session directories
     * Creates multiple watchers to monitor ALL VS Code storage paths simultaneously
     */
	private setupFileWatcher(): void {
		// Create multiple ForceFileWatcher instances, one for each storage path
		// This approach mirrors the global-log-scanner's robust multi-edition monitoring
		const watchers: ForceFileWatcher[] = [];
		
		for (const storagePath of this.storagePaths) {
			try {
				const edition = storagePath.includes('Insiders') ? 'VS Code Insiders' : 'VS Code Stable';
				this.logger.debug(`Setting up session file watcher for ${edition}: ${storagePath}`);
				
				// Create pattern to watch: .../workspaceStorage/*/chatSessions/*.json
				const pattern = new vscode.RelativePattern(
					vscode.Uri.file(storagePath),
					'*/chatSessions/*.json'
				);
				
				const watcher = new ForceFileWatcher(
					pattern,
					0, // No forced flush needed for session files
					SESSION_SCAN_CONSTANTS.DEFAULT_DEBOUNCE_MS // Use configured debounce from options
				);
				
				// File change handler; ForceFileWatcher already applies per-file debouncing
				const handleFileChange = async (uri: vscode.Uri) => {
					try {
						// Verify this is a session file we care about
						if (!uri.fsPath.includes('chatSessions') || !uri.fsPath.endsWith('.json')) {
							this.logger.trace(`Ignoring irrelevant file change: ${uri.fsPath}`);
							return;
						}

						// Fast-change detection: skip parse if file length hasn't changed
						let stats: fs.Stats | undefined;
						try {
							stats = await fsPromises.stat(uri.fsPath);
							const prevSize = this.fileSizes.get(uri.fsPath);
							if (prevSize !== undefined && prevSize === stats.size) {
								this.logger.trace(`Skipping unchanged session file (size=${stats.size}): ${uri.fsPath}`);
								return;
							}
						} catch (e) {
							this.logger.trace(`Stat failed for ${uri.fsPath}, proceeding to parse. Error: ${e}`);
						}
						
						this.logger.trace(`${edition} session file change detected: ${uri.fsPath}`);
						
						const result = await this.parseSessionFile(uri.fsPath);
						if (result) {
							this.logger.debug(`File watcher parsed session change from ${edition}: ${result.session.sessionId}`);
							this.watcherCallbacks.forEach(callback => callback(result));
						}

						// Update last known size after handling (even if parsing yielded null)
						if (!stats) {
							try { stats = await fsPromises.stat(uri.fsPath); } catch { /* ignore */ }
						}
						if (stats) {
							this.fileSizes.set(uri.fsPath, stats.size);
						}
					} catch (error) {
						this.logger.error(`Error handling ${edition} file change ${uri.fsPath}: ${error}`);
					}
				};
				
				watcher.onDidCreate(handleFileChange);
				watcher.onDidChange(handleFileChange);
				watcher.onDidDelete((uri) => {
					this.logger.debug(`${edition} session file deleted: ${uri.fsPath}`);
					// Remove cached size to avoid stale state
					this.fileSizes.delete(uri.fsPath);
				});
				
				watcher.start();
				watchers.push(watcher);
				
				this.logger.info(`Session file watcher started for ${edition}`);
			} catch (error) {
				this.logger.error(`Failed to create session file watcher for ${storagePath}: ${error}`);
			}
		}
		
		if (watchers.length === 0) {
			this.logger.warn('No valid storage paths found for session file watching');
			return;
		}
		
		// Store all watchers for cleanup (need to update class to handle multiple watchers)
		this.sessionWatchers = watchers;
		
		this.logger.info(`Session file watching active across ${watchers.length} VS Code edition(s)`);
	}

	/**
     * Get VS Code storage paths - now returns the injected storage paths
     */
	private getVSCodeStoragePaths(): string[] {
		return this.storagePaths;
	}

	/**
     * Validate that a parsed object is a valid session
     */
	private isValidSession(obj: any): obj is CopilotChatSession {
		if (!obj) {
			return false;
		}
        
		// Check required session fields
		if (typeof obj.sessionId !== 'string') {
			this.logger.trace(`Invalid sessionId: ${typeof obj.sessionId}`);
			return false;
		}
        
		if (typeof obj.creationDate !== 'number') {
			this.logger.trace(`Invalid creationDate: ${typeof obj.creationDate}`);
			return false;
		}
        
		if (typeof obj.version !== 'number') {
			this.logger.trace(`Invalid version: ${typeof obj.version}`);
			return false;
		}
        
		if (!Array.isArray(obj.turns)) {
			this.logger.info(`Invalid turns: ${typeof obj.turns}`);
			return false;
		}
        
		// Check each turn structure
		for (let i = 0; i < obj.turns.length; i++) {
			const turn = obj.turns[i];

			if (!turn) {
				this.logger.trace(`Turn ${i} is falsy`);
				return false;
			}
            
			if (typeof turn.requestId !== 'string') {
				this.logger.trace(`Turn ${i} invalid requestId: ${typeof turn.requestId}`);
				return false;
			}
            
			if (typeof turn.timestamp !== 'number') {
				this.logger.trace(`Turn ${i} invalid timestamp: ${typeof turn.timestamp}`);
				return false;
			}
            
			// modelId is optional - many requests legitimately don't have it
			if (turn.modelId !== undefined && typeof turn.modelId !== 'string') {
				this.logger.trace(`Turn ${i} invalid modelId: ${typeof turn.modelId}`);
				return false;
			}
            
			if (!turn.message || typeof turn.message.text !== 'string') {
				this.logger.trace(`Turn ${i} invalid message: ${!turn.message ? 'missing' : typeof turn.message.text}`);
				return false;
			}
            
			// agent is optional - slash commands like /clear don't have an agent
			if (turn.agent !== undefined) {
				if (typeof turn.agent.id !== 'string') {
					this.logger.trace(`Turn ${i} invalid agent.id: ${typeof turn.agent.id}`);
					return false;
				}
			}
            
			// Validate result.metadata.toolCallRounds if present (CRITICAL FOR NOT LOSING DATA)
			if (turn.result?.metadata?.toolCallRounds) {
				if (!Array.isArray(turn.result.metadata.toolCallRounds)) {
					this.logger.trace(`Turn ${i} invalid toolCallRounds: not an array`);
					return false;
				}
                
				// Validate each toolCallRound
				for (let j = 0; j < turn.result.metadata.toolCallRounds.length; j++) {
					const round = turn.result.metadata.toolCallRounds[j];

					if (!round || typeof round !== 'object') {
						this.logger.trace(`Turn ${i} toolCallRound ${j} invalid: not an object`);
						return false;
					}
                    
					if (typeof round.id !== 'string') {
						this.logger.trace(`Turn ${i} toolCallRound ${j} invalid id: ${typeof round.id}`);
						return false;
					}
                    
					if (typeof round.response !== 'string') {
						this.logger.trace(`Turn ${i} toolCallRound ${j} invalid response: ${typeof round.response}`);
						return false;
					}
                    
					if (!Array.isArray(round.toolCalls)) {
						this.logger.trace(`Turn ${i} toolCallRound ${j} invalid toolCalls: ${typeof round.toolCalls}`);
						return false;
					}
                    
					if (typeof round.toolInputRetry !== 'number') {
						this.logger.trace(`Turn ${i} toolCallRound ${j} invalid toolInputRetry: ${typeof round.toolInputRetry}`);
						return false;
					}
                    
					// Validate each toolCall in the round
					for (let k = 0; k < round.toolCalls.length; k++) {
						const toolCall = round.toolCalls[k];
                        
						if (!toolCall || typeof toolCall !== 'object') {
							this.logger.trace(`Turn ${i} toolCallRound ${j} toolCall ${k} invalid: not an object`);
							return false;
						}
                        
						if (typeof toolCall.id !== 'string') {
							this.logger.trace(`Turn ${i} toolCallRound ${j} toolCall ${k} invalid id: ${typeof toolCall.id}`);
							return false;
						}
                        
						if (typeof toolCall.name !== 'string') {
							this.logger.trace(`Turn ${i} toolCallRound ${j} toolCall ${k} invalid name: ${typeof toolCall.name}`);
							return false;
						}
                        
						if (typeof toolCall.arguments !== 'string') {
							this.logger.trace(`Turn ${i} toolCallRound ${j} toolCall ${k} invalid arguments: ${typeof toolCall.arguments}`);
							return false;
						}
					}
				}

				this.logger.debug(`Turn ${i} has ${turn.result.metadata.toolCallRounds.length} toolCallRounds - data preserved`);
			}
		}
        
		return true;
	}

	/**
     * Get scanner statistics
     */
	private getWatcherStatus(): { 
		isWatching: boolean; 
		callbackCount: number; 
		watcherCount: number;
		monitoredEditions: string[];
	} {
		const monitoredEditions = this.storagePaths.map(path => 
			path.includes('Insiders') ? 'VS Code Insiders' : 'VS Code Stable'
		);
		
		return {
			isWatching: this.isWatching,
			callbackCount: this.watcherCallbacks.length,
			watcherCount: this.sessionWatchers.length,
			monitoredEditions
		};
	}

	/**
     * Get the storage paths that were last used for scanning
     */
	private getLastUsedStoragePaths(): string[] {
		return [...this.lastUsedStoragePaths];
	}

	/**
     * Get detailed information about discovered workspaces and session counts
     */
	private async getWorkspaceInfo(storagePaths?: string[]): Promise<{ workspaces: any[]; totalSessions: number }> {
		const pathsToUse = storagePaths || this.lastUsedStoragePaths;
		const workspaces: any[] = [];
		let totalSessions = 0;

		for (const storagePath of pathsToUse) {
			try {
				await fsPromises.access(storagePath);
				const workspaceDirs = await fsPromises.readdir(storagePath, { withFileTypes: true });
				
				for (const workspaceDir of workspaceDirs) {
					if (!workspaceDir.isDirectory()) {
						continue;
					}
					
					const chatSessionsPath = path.join(storagePath, workspaceDir.name, SESSION_SCAN_CONSTANTS.CHAT_SESSIONS_DIR);
					
					try {
						await fsPromises.access(chatSessionsPath);
						const sessionFiles = await fsPromises.readdir(chatSessionsPath);
						const jsonFiles = sessionFiles.filter(f => SESSION_SCAN_CONSTANTS.SESSION_FILE_PATTERN.test(f));
						
						workspaces.push({
							hash: workspaceDir.name,
							storagePath: storagePath,
							chatSessionsPath: chatSessionsPath,
							sessionCount: jsonFiles.length,
							edition: storagePath.includes('Insiders') ? 'VS Code Insiders' : 'VS Code Stable'
						});
						
						totalSessions += jsonFiles.length;
					} catch {
						// No chatSessions directory
						continue;
					}
				}
			} catch (error) {
				this.logger.error(`Error scanning workspace info for ${storagePath}: ${error}`);
			}
		}

		return { workspaces, totalSessions };
	}

	/**
     * Cleanup resources
     */
	dispose(): void {
		this.stopWatching();
	}
}
