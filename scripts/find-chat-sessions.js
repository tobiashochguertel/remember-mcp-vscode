#!/usr/bin/env node

/**
 * Chat Session File Finder
 * 
 * INTENTION:
 * This script is the definitive tool for locating and analyzing VS Code Copilot chat 
 * session files when debugging analytics issues or investigating session data problems.
 * 
 * USE CASES:
 * 1. Find the current active chat session file (most recently modified)
 * 2. Debug why analytics shows incorrect file counts or session data
 * 3. Locate specific conversation sessions by modification time
 * 4. Verify that session data is being written to disk correctly
 * 5. Identify which workspace contains which chat sessions
 * 
 * WHAT IT DOES:
 * - Scans ALL VS Code Insiders workspace storage directories
 * - Finds ALL chatSession JSON files across all workspaces
 * - Sorts by modification time (most recent first)
 * - Shows file size, modification time, workspace ID, and full path
 * - Provides human-readable time formatting ("2 minutes ago", "1 hour ago")
 * 
 * WHEN TO USE:
 * - Analytics service shows unexpected file counts (like "only 4 files today")
 * - Need to find which session file contains current conversation
 * - Debugging timestamp filtering issues in analytics
 * - Verifying session data is being captured correctly
 * - Investigating workspace-specific session storage
 * 
 * TECHNICAL DETAILS:
 * - Searches: %APPDATA%\Code - Insiders\User\workspaceStorage\*\chatSessions\*.json
 * - Only targets VS Code Insiders (not Stable)
 * - Reads file modification times from filesystem (not file contents)
 * - Handles read permission errors gracefully
 * 
 * USAGE EXAMPLES:
 *   node scripts/find-chat-sessions.js              # Show top 20 files
 *   node scripts/find-chat-sessions.js --limit 10   # Show top 10 files  
 *   node scripts/find-chat-sessions.js --all        # Show ALL files
 *   node scripts/find-chat-sessions.js --help       # Show help
 * 
 * OUTPUT FORMAT:
 *   1. filename.json
 *      Modified: 2025-08-20T16:33:47.800Z (2 minutes ago)
 *      Size: 4.3 MB
 *      Workspace: f609d549db953c7022a83e91443f8cf2
 *      Path: C:\Users\...\workspaceStorage\...\chatSessions\filename.json
 * 
 * INTEGRATION:
 * Can be imported as a module:
 *   const { findAllChatSessionFiles } = require('./scripts/find-chat-sessions.js');
 *   const files = findAllChatSessionFiles({ limit: 5 });
 * 
 * @author Remember MCP VS Code Extension
 * @version 1.0.0
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function findAllChatSessionFiles(options = {}) {
    const { limit = 20 } = options;
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const insiderStoragePath = path.join(appData, 'Code - Insiders', 'User', 'workspaceStorage');
    
    console.log('Searching for chat session files in:', insiderStoragePath);
    console.log('');
    
    if (!fs.existsSync(insiderStoragePath)) {
        console.log('VS Code Insiders workspace storage not found!');
        return [];
    }
    
    const allChatFiles = [];
    
    try {
        const workspaces = fs.readdirSync(insiderStoragePath);
        
        for (const workspace of workspaces) {
            const chatSessionsPath = path.join(insiderStoragePath, workspace, 'chatSessions');
            
            if (fs.existsSync(chatSessionsPath)) {
                try {
                    const files = fs.readdirSync(chatSessionsPath)
                        .filter(f => f.endsWith('.json'))
                        .map(f => {
                            const filepath = path.join(chatSessionsPath, f);
                            const stat = fs.statSync(filepath);
                            return { 
                                filename: f, 
                                fullPath: filepath, 
                                modified: stat.mtime,
                                workspace: workspace,
                                size: stat.size
                            };
                        });
                    
                    allChatFiles.push(...files);
                } catch (error) {
                    console.log(`Could not read chatSessions in workspace ${workspace}: ${error.message}`);
                }
            }
        }
        
        // Sort by modification time, most recent first
        allChatFiles.sort((a, b) => b.modified - a.modified);
        
        console.log(`Found ${allChatFiles.length} chat session files:`);
        console.log('');
        
        const displayFiles = limit > 0 ? allChatFiles.slice(0, limit) : allChatFiles;
        
        displayFiles.forEach((file, i) => {
            const timeAgo = getTimeAgo(file.modified);
            const sizeFormatted = formatBytes(file.size);
            console.log(`${(i + 1).toString().padStart(2)}. ${file.filename}`);
            console.log(`    Modified: ${file.modified.toISOString()} (${timeAgo})`);
            console.log(`    Size: ${sizeFormatted}`);
            console.log(`    Workspace: ${file.workspace}`);
            console.log(`    Path: ${file.fullPath}`);
            console.log('');
        });
        
        if (limit > 0 && allChatFiles.length > limit) {
            console.log(`... and ${allChatFiles.length - limit} more files`);
        }
        
        return allChatFiles;
        
    } catch (error) {
        console.log('Error scanning workspace storage:', error.message);
        return [];
    }
}

function getTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffMinutes < 1) {
        return 'just now';
    } else if (diffMinutes < 60) {
        return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
    } else if (diffHours < 24) {
        return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    } else {
        return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    }
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// CLI interface
function parseArgs() {
    const args = process.argv.slice(2);
    const options = { limit: 20 };
    
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--limit' && i + 1 < args.length) {
            options.limit = parseInt(args[i + 1], 10);
            i++; // Skip the next argument
        } else if (args[i] === '--all') {
            options.limit = 0; // Show all files
        } else if (args[i] === '--help' || args[i] === '-h') {
            console.log('Usage: node scripts/find-chat-sessions.js [options]');
            console.log('');
            console.log('Options:');
            console.log('  --limit <n>    Show only the first n files (default: 20)');
            console.log('  --all          Show all files (no limit)');
            console.log('  --help, -h     Show this help message');
            process.exit(0);
        }
    }
    
    return options;
}

// Main execution
if (require.main === module) {
    const options = parseArgs();
    findAllChatSessionFiles(options);
}

// Export for use as module
module.exports = { findAllChatSessionFiles, getTimeAgo, formatBytes };