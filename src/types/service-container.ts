/**
 * Service Container - Dependency injection container for the extension
 * Ensures single instances of services are shared across the extension
 */

import * as vscode from 'vscode';
import { ILogger, Logger } from './logger';
import { UnifiedSessionDataService, SessionDataServiceOptions } from '../services/unified-session-data-service';
import { AnalyticsService } from '../services/analytics-service';
import { ChatSessionScanner } from '../scanning/chat-session-scanner';
import { GlobalLogScanner } from '../scanning/global-log-scanner';
import { getVSCodeStoragePaths } from '../util/vscode-paths';

export interface ServiceContainerOptions {
	extensionContext: vscode.ExtensionContext;
	logger: ILogger; // Kept for backwards compatibility, but will use Logger.getInstance()
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
	) {
		const log = Logger.getInstance('ServiceContainer');
		log.debug('ServiceContainer constructor called');
		log.trace(`Extension version: ${extensionVersion}`);
		log.trace('Session data service options:', sessionDataServiceOptions);
	}

	/**
     * Initialize the service container (should be called once from extension activation)
     */
	static initialize(options: ServiceContainerOptions): ServiceContainer {
		const log = Logger.getInstance('ServiceContainer');
		log.info('Initializing ServiceContainer');
		
		if (ServiceContainer.instance) {
			log.warn('ServiceContainer already initialized, returning existing instance');
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
        
		log.info('ServiceContainer initialized successfully');
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
		const log = Logger.getInstance('ServiceContainer');
		
		if (!this._unifiedSessionDataService) {
			log.info('Creating UnifiedSessionDataService instance');
			
			// Create storage paths
			const storagePaths = this.getVSCodeStoragePaths();
			log.debug(`Found ${storagePaths.length} VS Code storage paths`);
			log.trace('Storage paths:', storagePaths);
			
			// Create session scanner
			const sessionScanner = new ChatSessionScanner(
				storagePaths,
				this.logger
			);
			
			// Create global log scanner (replaces prior CopilotLogScanner)
			const logScanner = new GlobalLogScanner(this.logger);
			
			this._unifiedSessionDataService = new UnifiedSessionDataService(
				sessionScanner,
				logScanner,
				this.logger,
				this.extensionVersion,
				this.sessionDataServiceOptions,
			);

			log.debug('Initializing UnifiedSessionDataService asynchronously');
			this._unifiedSessionDataService.initialize().catch(err => {
				log.error(`Unified session data service initialization failed: ${err}`);
			});
		} else {
			log.trace('Returning existing UnifiedSessionDataService instance');
		}
		return this._unifiedSessionDataService;
	}

	/**
	 * Get VS Code storage paths for session scanning
	 * Uses OS-aware path resolution to support Windows, macOS, and Linux
	 */
	private getVSCodeStoragePaths(): string[] {
		const log = Logger.getInstance('ServiceContainer');
		const paths = getVSCodeStoragePaths();
		
		log.debug(`Resolved ${paths.length} OS-specific storage paths for session scanning`);
		log.trace('Storage paths:', paths);
		return paths;
	}

	/**
	 * Get the analytics service (creates if not exists)
	 */
	getAnalyticsService(): AnalyticsService {
		const log = Logger.getInstance('ServiceContainer');
		
		if (!this._analyticsService) {
			log.info('Creating AnalyticsService instance');
			const unified = this.getUnifiedSessionDataService();
			this._analyticsService = new AnalyticsService(this.logger, unified);
			log.debug('AnalyticsService created successfully');
		} else {
			log.trace('Returning existing AnalyticsService instance');
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
		const log = Logger.getInstance('ServiceContainer');
		log.info('Disposing ServiceContainer and all services');
        
		if (this._unifiedSessionDataService) {
			log.debug('Disposing UnifiedSessionDataService');
			this._unifiedSessionDataService.dispose();
			this._unifiedSessionDataService = undefined;
		}
		
		if (this._analyticsService) {
			log.debug('Clearing AnalyticsService reference');
			this._analyticsService = undefined;
		}
        
		ServiceContainer.instance = null;
		log.info('ServiceContainer disposed successfully');
	}

	/**
     * Reset the container (for testing)
     */
	static reset(): void {
		const log = Logger.getInstance('ServiceContainer');
		log.warn('Resetting ServiceContainer (for testing)');
		
		if (ServiceContainer.instance) {
			ServiceContainer.instance.dispose();
		}
		ServiceContainer.instance = null;
		log.debug('ServiceContainer reset complete');
	}
}
