#!/usr/bin/env node

/**
 * Copilot Session Monitor
 * 
 * A persistent monitoring tool for tracking VS Code Copilot chat sessions and extension logs.
 * Automatically discovers session storage paths from the running Remember MCP extension
 * and provides real-time monitoring of session file changes and extension activity.
 * 
 * Features:
 * - Auto-discovery of VS Code storage paths via extension global storage
 * - Real-time monitoring of session file updates
 * - Extension log monitoring with structured output
 * - Test message tracking for debugging
 * - Cross-platform path handling
 * - Graceful error handling and retry logic
 * 
 * Usage:
 *   node scripts/monitor-copilot-sessions.js [--test-message "YOUR_TEST"] [--interval 2000]
 * 
 * @author Remember MCP VS Code Extension
 * @version 1.0.0
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class CopilotSessionMonitor {
    constructor(options = {}) {
        this.testMessage = options.testMessage || 'HELLO DEBUGGER COPILOT!';
        this.interval = options.interval || 2000; // 2 seconds
        this.isRunning = false;
        this.intervalId = null;
        
        // State tracking
        this.lastSessionCount = 0;
        this.lastSessionModified = new Map();
        this.lastExtensionLogSize = 0;
        this.discoveredPaths = null;
        this.extensionLogPath = null;
        
        // Bind methods for event handlers
        this.handleGracefulShutdown = this.handleGracefulShutdown.bind(this);
    }

    /**
     * Get the expected global storage path for the Remember MCP extension
     */
    getGlobalStoragePath() {
        const appDataRoot = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        return path.join(appDataRoot, 'Code - Insiders', 'User', 'globalStorage', 'nickeolofsson.remember-mcp-vscode', 'discovered-paths.json');
    }

    /**
     * Load discovered paths from extension global storage
     */
    async loadDiscoveredPaths() {
        const globalStoragePath = this.getGlobalStoragePath();
        
        try {
            const content = await fs.readFile(globalStoragePath, 'utf-8');
            const pathsData = JSON.parse(content);
            
            console.log(`📂 Loaded paths from extension (discovered at: ${pathsData.discoveredAt})`);
            console.log(`   Extension version: ${pathsData.extensionVersion}`);
            console.log(`   Current workspace: ${pathsData.currentWorkspaceHash}`);
            console.log(`   Current chat sessions path: ${pathsData.currentChatSessionsPath}`);
            
            this.discoveredPaths = pathsData;
            return this.discoveredPaths;
        } catch (error) {
            console.log(`⚠️  Could not load paths from extension: ${error.message}`);
            console.log(`   Expected location: ${globalStoragePath}`);
            console.log(`   Make sure the Remember MCP extension is running in VS Code`);
            return null;
        }
    }

    /**
     * Discover extension log path based on current VS Code session
     */
    async discoverExtensionLogPath() {
        if (!this.discoveredPaths?.currentWorkspaceHash) {
            return null;
        }

        const appDataRoot = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        const logsRoot = path.join(appDataRoot, 'Code - Insiders', 'logs');
        
        try {
            // Find the most recent log directory
            const logDirs = await fs.readdir(logsRoot, { withFileTypes: true });
            const dateDirs = logDirs
                .filter(d => d.isDirectory() && /^\d{8}T\d{6}$/.test(d.name))
                .sort((a, b) => b.name.localeCompare(a.name)); // Most recent first
            
            if (dateDirs.length === 0) {
                return null;
            }

            // Look for window directories in the most recent log
            const recentLogDir = path.join(logsRoot, dateDirs[0].name);
            const windowDirs = await fs.readdir(recentLogDir, { withFileTypes: true });
            const windows = windowDirs.filter(d => d.isDirectory() && d.name.startsWith('window'));
            
            // Try each window to find the extension log
            for (const windowDir of windows) {
                const extLogPath = path.join(
                    recentLogDir, 
                    windowDir.name, 
                    'exthost', 
                    'nickeolofsson.remember-mcp-vscode', 
                    'Remember MCP.log'
                );
                
                try {
                    await fs.access(extLogPath);
                    console.log(`📋 Found extension log: ${extLogPath}`);
                    return extLogPath;
                } catch {
                    // Try next window
                    continue;
                }
            }
            
            return null;
        } catch (error) {
            console.log(`⚠️  Could not discover extension log: ${error.message}`);
            return null;
        }
    }

    /**
     * Get all session files from current chat sessions path
     */
    async getAllSessionFiles() {
        if (!this.discoveredPaths?.currentChatSessionsPath) {
            return [];
        }

        const allFiles = [];
        const chatSessionsPath = this.discoveredPaths.currentChatSessionsPath;
        
        try {
            await fs.access(chatSessionsPath);
            const sessionFiles = await fs.readdir(chatSessionsPath);
            
            for (const sessionFile of sessionFiles) {
                if (sessionFile.endsWith('.json')) {
                    const fullPath = path.join(chatSessionsPath, sessionFile);
                    try {
                        const stats = await fs.stat(fullPath);
                        allFiles.push({
                            path: fullPath,
                            name: sessionFile,
                            modified: stats.mtime
                        });
                    } catch (error) {
                        console.log(`   ⚠️  Could not stat ${sessionFile}: ${error.message}`);
                    }
                }
            }
        } catch (error) {
            console.log(`   ⚠️  Could not access chat sessions path: ${error.message}`);
        }

        return allFiles;
    }

    /**
     * Initialize the monitor
     */
    async initialize() {
        console.log('🚀 Copilot Session Monitor v1.0.0');
        console.log(`🔍 Test message: "${this.testMessage}"`);
        console.log(`⏱️  Monitor interval: ${this.interval}ms`);
        console.log('');

        // Load paths from extension
        await this.loadDiscoveredPaths();
        
        if (!this.discoveredPaths) {
            console.log('❌ Cannot proceed without discovered paths. Please ensure:');
            console.log('   1. VS Code Insiders is running');
            console.log('   2. Remember MCP extension is active');
            console.log('   3. Extension has scanned for sessions at least once');
            process.exit(1);
        }

        // Discover extension log
        this.extensionLogPath = await this.discoverExtensionLogPath();
        
        // Get initial state
        await this.updateInitialState();
        
        console.log('✅ Monitor initialized successfully');
        console.log('');
    }

    /**
     * Update initial state for comparison
     */
    async updateInitialState() {
        try {
            const sessionFiles = await this.getAllSessionFiles();
            this.lastSessionCount = sessionFiles.length;
            
            for (const filePath of sessionFiles) {
                try {
                    const stats = await fs.stat(filePath);
                    this.lastSessionModified.set(filePath, stats.mtime.getTime());
                } catch {
                    // File might have been deleted, skip
                    continue;
                }
            }
            
            if (this.extensionLogPath) {
                try {
                    const extStats = await fs.stat(this.extensionLogPath);
                    this.lastExtensionLogSize = extStats.size;
                } catch {
                    this.lastExtensionLogSize = 0;
                }
            }
            
            console.log(`📊 Initial state: ${this.lastSessionCount} session files`);
            if (this.extensionLogPath) {
                console.log(`📋 Extension log: ${(this.lastExtensionLogSize / 1024).toFixed(1)}KB`);
            }
        } catch (error) {
            console.log(`⚠️  Error getting initial state: ${error.message}`);
        }
    }

    /**
     * Check for changes in session files and logs
     */
    async checkForChanges() {
        try {
            // Check session files
            const sessionFiles = await this.getAllSessionFiles();
            
            if (sessionFiles.length !== this.lastSessionCount) {
                console.log(`📈 ${new Date().toISOString()} - Session count changed: ${this.lastSessionCount} → ${sessionFiles.length}`);
                this.lastSessionCount = sessionFiles.length;
            }
            
            // Check for modified session files
            for (const filePath of sessionFiles) {
                try {
                    const stats = await fs.stat(filePath);
                    const currentModified = stats.mtime.getTime();
                    const lastModified = this.lastSessionModified.get(filePath) || 0;
                    
                    if (currentModified > lastModified) {
                        const fileName = path.basename(filePath);
                        console.log(`📝 ${new Date().toISOString()} - Session updated: ${fileName}`);
                        console.log(`   Path: ${filePath}`);
                        console.log(`   Size: ${(stats.size / 1024).toFixed(1)}KB, Modified: ${stats.mtime.toISOString()}`);
                        
                        // Check for test message
                        await this.checkForTestMessage(filePath, fileName);
                        
                        this.lastSessionModified.set(filePath, currentModified);
                    }
                } catch (error) {
                    // File might have been deleted
                    console.log(`⚠️  Could not check ${filePath}: ${error.message}`);
                }
            }
            
            // Check extension log
            if (this.extensionLogPath) {
                await this.checkExtensionLog();
            }
            
        } catch (error) {
            console.log(`⚠️  Monitor error: ${error.message}`);
        }
    }

    /**
     * Check session file for test message
     */
    async checkForTestMessage(filePath, fileName) {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            
            if (content.includes(this.testMessage)) {
                console.log(`🎯 FOUND TEST MESSAGE in ${fileName}!`);
                
                const session = JSON.parse(content);
                const testRequests = session.requests.filter(req => 
                    req.message?.text?.includes(this.testMessage)
                );
                
                console.log(`   Session ID: ${session.sessionId}`);
                console.log(`   Total Requests: ${session.requests.length}`);
                console.log(`   Test Messages: ${testRequests.length}`);
                
                // Show the newest test message
                const newestTest = testRequests[testRequests.length - 1];
                if (newestTest) {
                    console.log(`   Newest Test Message:`);
                    console.log(`     Timestamp: ${new Date(newestTest.timestamp).toISOString()}`);
                    console.log(`     Model: ${newestTest.modelId || 'Unknown'}`);
                    console.log(`     Agent: ${newestTest.agent?.id || 'Unknown'}`);
                    console.log(`     Message: "${newestTest.message.text.substring(0, 100)}${newestTest.message.text.length > 100 ? '...' : ''}"`);
                }
            }
        } catch (parseError) {
            console.log(`   ⚠️  Could not parse session file: ${parseError.message}`);
        }
    }

    /**
     * Check extension log for changes
     */
    async checkExtensionLog() {
        try {
            const extStats = await fs.stat(this.extensionLogPath);
            
            if (extStats.size !== this.lastExtensionLogSize) {
                console.log(`📋 ${new Date().toISOString()} - Extension log updated`);
                console.log(`   Size: ${(this.lastExtensionLogSize / 1024).toFixed(1)}KB → ${(extStats.size / 1024).toFixed(1)}KB`);
                
                // Show recent log entries
                const content = await fs.readFile(this.extensionLogPath, 'utf-8');
                const lines = content.split('\n').filter(line => line.trim());
                
                // Estimate where new content starts (rough calculation)
                const estimatedOldLines = Math.floor(this.lastExtensionLogSize / 100);
                const newLines = lines.slice(estimatedOldLines);
                
                if (newLines.length > 0) {
                    console.log(`   📝 Recent log entries:`);
                    newLines.slice(-3).forEach(line => {
                        if (line.trim()) {
                            // Truncate very long lines
                            const truncated = line.length > 150 ? line.substring(0, 147) + '...' : line;
                            console.log(`     ${truncated}`);
                        }
                    });
                }
                
                this.lastExtensionLogSize = extStats.size;
            }
        } catch (extError) {
            console.log(`   ⚠️  Extension log error: ${extError.message}`);
        }
    }

    /**
     * Start the monitoring loop
     */
    async start() {
        if (this.isRunning) {
            console.log('⚠️  Monitor is already running');
            return;
        }

        await this.initialize();
        
        this.isRunning = true;
        console.log(`🔄 Starting monitor (every ${this.interval}ms)...`);
        console.log('📝 Send test messages in VS Code to track them!');
        console.log('⏹️  Press Ctrl+C to stop');
        console.log('');
        
        // Set up graceful shutdown
        process.on('SIGINT', this.handleGracefulShutdown);
        process.on('SIGTERM', this.handleGracefulShutdown);
        
        // Start monitoring loop
        this.intervalId = setInterval(() => {
            this.checkForChanges().catch(error => {
                console.log(`⚠️  Check failed: ${error.message}`);
            });
        }, this.interval);
    }

    /**
     * Stop the monitoring loop
     */
    stop() {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;
        
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        
        // Remove event listeners
        process.removeListener('SIGINT', this.handleGracefulShutdown);
        process.removeListener('SIGTERM', this.handleGracefulShutdown);
        
        console.log('\n⏹️  Monitor stopped');
    }

    /**
     * Handle graceful shutdown
     */
    handleGracefulShutdown() {
        console.log('\n🛑 Shutting down monitor...');
        this.stop();
        process.exit(0);
    }
}

// CLI interface
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {};
    
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--test-message':
                options.testMessage = args[++i];
                break;
            case '--interval':
                options.interval = parseInt(args[++i], 10);
                break;
            case '--help':
            case '-h':
                console.log(`
Copilot Session Monitor - Track VS Code Copilot chat sessions in real-time

Usage: node scripts/monitor-copilot-sessions.js [options]

Options:
  --test-message <text>    Test message to track (default: "HELLO DEBUGGER COPILOT!")
  --interval <ms>          Monitor interval in milliseconds (default: 2000)
  --help, -h              Show this help message

Examples:
  node scripts/monitor-copilot-sessions.js
  node scripts/monitor-copilot-sessions.js --test-message "MY TEST" --interval 1000
`);
                process.exit(0);
                break;
        }
    }
    
    return options;
}

// Main execution
if (require.main === module) {
    const options = parseArgs();
    const monitor = new CopilotSessionMonitor(options);
    
    monitor.start().catch(error => {
        console.error(`❌ Failed to start monitor: ${error.message}`);
        process.exit(1);
    });
}

module.exports = CopilotSessionMonitor;
