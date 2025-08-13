/**
 * Shared utility functions for discovering VS Code log paths
 * 
 * These are pure utility functions with no event logic - just path discovery.
 * Used by both GlobalLogScanner and WindowLogWatcher.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export class LogPathDiscovery {
	/**
	 * VS Code log directory locations for different versions
	 * On Windows: %AppData%\Code\logs and %AppData%\Code - Insiders\logs
	 */
	private static readonly VSCODE_LOG_PATHS = [
		'Code\\logs',           // VS Code Stable
		'Code - Insiders\\logs' // VS Code Insiders
	];

	/**
	 * Get all VS Code log root directories (both Stable and Insiders)
	 * Returns absolute paths to log directories that exist
	 */
	static getVSCodeLogRootDirectories(): string[] {
		const appDataPath = process.env.APPDATA;
		if (!appDataPath) {
			return [];
		}

		const logRoots: string[] = [];
		for (const relativePath of LogPathDiscovery.VSCODE_LOG_PATHS) {
			const fullPath = path.join(appDataPath, relativePath);
			try {
				// Check if directory exists synchronously for this discovery method
				if (require('fs').existsSync(fullPath)) {
					logRoots.push(fullPath);
				}
			} catch {
				// Directory doesn't exist or can't be accessed, skip it
			}
		}
		return logRoots;
	}

	/**
	 * Find ALL Copilot log files across all sessions, all days, all VS Code versions
	 * This provides comprehensive historical data collection
	 */
	static async findAllHistoricalLogPaths(): Promise<{ logPath: string; version: string; session: string }[]> {
		const logRoots = LogPathDiscovery.getVSCodeLogRootDirectories();
		const allLogPaths: { logPath: string; version: string; session: string }[] = [];

		for (const logRoot of logRoots) {
			const versionName = logRoot.includes('Insiders') ? 'VS Code Insiders' : 'VS Code Stable';

			try {
				// Get all session directories (date-timestamp format like 20250813T110757)
				const sessionDirs = await fs.readdir(logRoot);
				
				for (const sessionName of sessionDirs) {
					const sessionPath = path.join(logRoot, sessionName);
					
					try {
						const sessionStat = await fs.stat(sessionPath);
						if (!sessionStat.isDirectory()) {
							continue;
						}

						// Search all windows in this session
						const windowDirs = await fs.readdir(sessionPath);
						const windowPaths = windowDirs
							.filter(name => name.startsWith('window'))
							.map(name => path.join(sessionPath, name, 'exthost'));

						for (const exthostPath of windowPaths) {
							try {
								const exthostContents = await fs.readdir(exthostPath);
								const copilotDirs = exthostContents.filter(name => 
									name.toLowerCase().includes('github') && 
									name.toLowerCase().includes('copilot-chat')
								);

								for (const copilotDirName of copilotDirs) {
									const copilotLogDir = path.join(exthostPath, copilotDirName);
									const logPath = await LogPathDiscovery.findLogInDirectory(copilotLogDir);
									
									if (logPath) {
										allLogPaths.push({
											logPath,
											version: versionName,
											session: sessionName
										});
									}
								}
							} catch {
								// Could not read exthost directory, skip
								continue;
							}
						}
					} catch {
						// Could not read session directory, skip
						continue;
					}
				}
			} catch {
				// Could not read log root directory, skip
				continue;
			}
		}

		return allLogPaths;
	}

	/**
	 * Find the Copilot Chat log file for a specific window's exthost directory
	 */
	static async findLogInDirectory(copilotLogDir: string): Promise<string | null> {
		try {
			// Find the .log file
			const files = await fs.readdir(copilotLogDir);
			const logFile = files.find(f => f.endsWith('.log'));

			if (logFile) {
				const logPath = path.join(copilotLogDir, logFile);
				return logPath;
			} else {
				return null;
			}
		} catch {
			return null;
		}
	}

	/**
	 * Find the Copilot Chat log file for the CURRENT SESSION/WINDOW using extension context
	 */
	static async findCurrentWindowLogPath(extensionLogUri: string): Promise<string | null> {
		try {
			// The extension's logUri points to something like:
			// .../logs/20250813T110757/window1/exthost/nickeolofsson.remember-mcp-vscode
			// We need to navigate to the same window's exthost directory and find GitHub.copilot-chat
			
			// Go up from extension-specific directory to the exthost directory of THIS SPECIFIC WINDOW
			const exthostDir = path.dirname(extensionLogUri);

			// Look for GitHub.copilot-chat in the SAME exthost directory as this extension
			try {
				const exthostContents = await fs.readdir(exthostDir);
				const copilotDirs = exthostContents.filter(name => 
					name.toLowerCase().includes('github') && 
					name.toLowerCase().includes('copilot-chat')
				);

				if (copilotDirs.length === 0) {
					return null;
				}

				// Use the first (and typically only) Copilot directory in this window
				const copilotDirName = copilotDirs[0];
				const copilotLogDir = path.join(exthostDir, copilotDirName);
				const logPath = await LogPathDiscovery.findLogInDirectory(copilotLogDir);
				
				return logPath;
			} catch {
				return null;
			}
		} catch {
			return null;
		}
	}

	/**
	 * Get directory containing a log file
	 */
	static getLogDirectory(logFilePath: string): string {
		return path.dirname(logFilePath);
	}
}
