/**
 * Types & constants for scanning Copilot editing state timelines.
 * Initial minimal schema – deliberately permissive until enrichment layer formalizes.
 */

export interface EditStateFile {
	version: number;
	sessionId: string;
	linearHistory: any[]; // Detailed structure will be modeled later
	// Other fields may exist; we ignore them for now.
	[key: string]: any; // forward compatibility
}

export interface EditStateScanResult {
	stateFilePath: string;
	state: EditStateFile;
	lastModified: Date;
	fileSize: number;
}

export interface EditStateScanStats {
	totalStateFiles: number;
	totalTurns: number;            // Sum of linearHistory length across files (approx turns)
	scannedFiles: number;          // Number of candidate files looked at
	errorFiles: number;            // Files that failed to parse/validate
	scanDuration: number;          // ms
	oldestSession?: string;        // ISO date of oldest (by heuristic – none yet, placeholder)
	newestSession?: string;        // ISO date of newest
}

export interface EditStateWatcherOptions {
	enableWatching: boolean;
	debounceMs: number;
	maxRetries: number;
}

export const EDIT_STATE_SCAN_CONSTANTS = {
	DEFAULT_DEBOUNCE_MS: 750,
	DEFAULT_MAX_RETRIES: 3,
	EDITING_SESSIONS_DIR: 'chatEditingSessions',
	STATE_FILE_NAME: 'state.json'
};
