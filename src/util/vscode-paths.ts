/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Niclas Olofsson. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as path from 'path';

/**
 * VS Code storage path configurations for different operating systems
 */
export interface VSCodeStorageConfig {
	/** Relative path from home directory for VS Code Stable */
	stable: string;
	/** Relative path from home directory for VS Code Insiders */
	insiders: string;
}

/**
 * Get VS Code storage paths configuration for the current operating system
 * 
 * VS Code stores workspace data in different locations depending on the OS:
 * - Windows: %APPDATA%\Code\User\workspaceStorage
 * - macOS: ~/Library/Application Support/Code/User/workspaceStorage
 * - Linux: ~/.config/Code/User/workspaceStorage
 */
export function getVSCodeStorageConfig(): VSCodeStorageConfig {
	const platform = os.platform();

	switch (platform) {
		case 'win32':
			// Windows: Use APPDATA environment variable path
			return {
				stable: path.join('AppData', 'Roaming', 'Code', 'User', 'workspaceStorage'),
				insiders: path.join('AppData', 'Roaming', 'Code - Insiders', 'User', 'workspaceStorage')
			};

		case 'darwin':
			// macOS: Use Library/Application Support
			return {
				stable: path.join('Library', 'Application Support', 'Code', 'User', 'workspaceStorage'),
				insiders: path.join('Library', 'Application Support', 'Code - Insiders', 'User', 'workspaceStorage')
			};

		case 'linux':
		default:
			// Linux and others: Use .config directory
			return {
				stable: path.join('.config', 'Code', 'User', 'workspaceStorage'),
				insiders: path.join('.config', 'Code - Insiders', 'User', 'workspaceStorage')
			};
	}
}

/**
 * Get absolute VS Code storage paths for the current user and operating system
 * Returns paths for both VS Code Stable and Insiders editions
 */
export function getVSCodeStoragePaths(): string[] {
	const homedir = os.homedir();
	const config = getVSCodeStorageConfig();

	return [
		path.join(homedir, config.stable),
		path.join(homedir, config.insiders)
	];
}
