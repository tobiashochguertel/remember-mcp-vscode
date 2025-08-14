/**
 * Service Container - Dependency injection container for the extension
 * Ensures single instances of services are shared across the extension
 */

import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { ILogger } from './logger';
import { UnifiedSessionDataService, SessionDataServiceOptions } from '../services/unified-session-data-service';
import { AnalyticsService } from '../services/analytics-service';
import { ChatSessionScanner } from '../scanning/chat-session-scanner';
// Switched to GlobalLogScanner for unified monitoring across instances
import { GlobalLogScanner } from '../scanning/global-log-scanner';
import { SessionDataTransformer } from '../services/session-data-transformer';
import { SESSION_SCAN_CONSTANTS } from './chat-session';

export interface ServiceContainerOptions {
	extensionContext: vscode.ExtensionContext;
	logger: ILogger;
	extensionVersion: string;
	sessionDataServiceOptions?: SessionDataServiceOptions;
}

/**
 * Singleton service container that manages all shared services
 */
export class ServiceContainer {
	private static instance: ServiceContainer | null = null;
    
	private _unifiedSessionDataService?: UnifiedSessionDataService;
	private _analyticsService?: AnalyticsService;
    
	private constructor(
		private readonly extensionContext: vscode.ExtensionContext,
		private readonly logger: ILogger,
		private readonly extensionVersion: string,
		private readonly sessionDataServiceOptions: SessionDataServiceOptions = {}
	) {}

	/**
     * Initialize the service container (should be called once from extension activation)
     */
	static initialize(options: ServiceContainerOptions): ServiceContainer {
		if (ServiceContainer.instance) {
			throw new Error('ServiceContainer is already initialized. Use getInstance() instead.');
		}
        
		ServiceContainer.instance = new ServiceContainer(
			options.extensionContext,
			options.logger,
			options.extensionVersion,
			{
				enableRealTimeUpdates: true,
				debounceMs: 500,
				...options.sessionDataServiceOptions
			}
		);
        
		return ServiceContainer.instance;
	}

	/**
     * Get the singleton instance (throws if not initialized)
     */
	static getInstance(): ServiceContainer {
		if (!ServiceContainer.instance) {
			throw new Error('ServiceContainer not initialized. Call initialize() first.');
		}
		return ServiceContainer.instance;
	}

	/**
     * Check if the container is initialized
     */
	static isInitialized(): boolean {
		return ServiceContainer.instance !== null;
	}

	/**
     * Get the unified session data service (creates if not exists)
     */
	getUnifiedSessionDataService(): UnifiedSessionDataService {
		if (!this._unifiedSessionDataService) {
			this.logger.info('Creating UnifiedSessionDataService instance');
			
			// Create storage paths
			const storagePaths = this.getVSCodeStoragePaths();
			
			// Create session scanner
			const sessionScanner = new ChatSessionScanner(
				storagePaths,
				this.logger,
				{
					enableWatching: this.sessionDataServiceOptions.enableRealTimeUpdates ?? true,
					debounceMs: this.sessionDataServiceOptions.debounceMs ?? 500,
					maxRetries: 3
				}
			);
			
			// Create global log scanner (replaces prior CopilotLogScanner)
			const logScanner = new GlobalLogScanner(this.logger);
			
			// Create session data transformer
			const sessionTransformer = new SessionDataTransformer(
				this.logger,
				this.extensionVersion
			);
			
			// Create unified service with injected dependencies
			this._unifiedSessionDataService = new UnifiedSessionDataService(
				sessionScanner,
				logScanner,
				sessionTransformer,
				this.logger,
				this.extensionVersion,
				this.sessionDataServiceOptions
			);
		}
		return this._unifiedSessionDataService;
	}

	/**
	 * Get VS Code storage paths for session scanning
	 */
	private getVSCodeStoragePaths(): string[] {
		const homedir = os.homedir();
		return SESSION_SCAN_CONSTANTS.VSCODE_STORAGE_PATHS.map(relativePath => 
			path.join(homedir, relativePath)
		);
	}

	/**
	 * Get the analytics service (creates if not exists)
	 */
	getAnalyticsService(): AnalyticsService {
		if (!this._analyticsService) {
			this.logger.info('Creating AnalyticsService instance');
			this._analyticsService = new AnalyticsService(this.logger);
		}
		return this._analyticsService;
	}

	/**
     * Get the extension context
     */
	getExtensionContext(): vscode.ExtensionContext {
		return this.extensionContext;
	}

	/**
     * Get the logger
     */
	getLogger(): ILogger {
		return this.logger;
	}

	/**
     * Get the extension version
     */
	getExtensionVersion(): string {
		return this.extensionVersion;
	}

	/**
     * Dispose all services and reset the singleton
     */
	dispose(): void {
		this.logger.info('Disposing services');
        
		if (this._unifiedSessionDataService) {
			this._unifiedSessionDataService.dispose();
			this._unifiedSessionDataService = undefined;
		}
		this._analyticsService = undefined;
        
		ServiceContainer.instance = null;
		this.logger.info('Service container disposed');
	}

	/**
     * Reset the container (for testing)
     */
	static reset(): void {
		if (ServiceContainer.instance) {
			ServiceContainer.instance.dispose();
		}
		ServiceContainer.instance = null;
	}
}
