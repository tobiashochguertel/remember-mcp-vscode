import * as vscode from 'vscode';

/**
 * Log levels in order of severity
 */
export enum LogLevel {
	TRACE = 0,
	DEBUG = 1,
	INFO = 2,
	WARN = 3,
	ERROR = 4
}

/**
 * Parse log level from string (e.g., from configuration)
 * @param level Log level as string
 * @returns Corresponding LogLevel enum value
 */
export function parseLogLevel(level: string): LogLevel {
	switch (level.toLowerCase()) {
		case 'trace':
			return LogLevel.TRACE;
		case 'debug':
			return LogLevel.DEBUG;
		case 'info':
			return LogLevel.INFO;
		case 'warn':
			return LogLevel.WARN;
		case 'error':
			return LogLevel.ERROR;
		default:
			return LogLevel.INFO;
	}
}

/**
 * Logging interface for dependency injection
 * Allows mocking in tests and different implementations
 */
export interface ILogger {
	trace(message: string, ...args: any[]): void;
	debug(message: string, ...args: any[]): void;
	info(message: string, ...args: any[]): void;
	warn(message: string, ...args: any[]): void;
	error(message: string, ...args: any[]): void;

	// Configuration
	setLogLevel(level: LogLevel): void;
	getLogLevel(): LogLevel;

	// Sub-logger support (tslog-style)
	getSubLogger(name: string): ILogger;
}

/**
 * VS Code LogOutputChannel implementation
 * Uses native VS Code log levels and timestamps
 * Supports hierarchical sub-loggers with configurable log levels
 */
export class VSCodeLogger implements ILogger {
	private hasShownChannel = false;
	private logLevel: LogLevel = LogLevel.INFO;
	private readonly parentNames: string[] = [];
	private readonly loggerName: string | undefined;
    
	constructor(
		private readonly outputChannel: vscode.LogOutputChannel,
		private readonly extensionMode: vscode.ExtensionMode = vscode.ExtensionMode.Production,
		name?: string,
		parentNames?: string[]
	) {
		this.loggerName = name;
		this.parentNames = parentNames || [];
	}

	setLogLevel(level: LogLevel): void {
		this.logLevel = level;
	}

	getLogLevel(): LogLevel {
		return this.logLevel;
	}

	/**
	 * Create a sub-logger with hierarchical name (tslog-style)
	 * @param name Name of the sub-logger
	 * @returns New logger instance with inherited settings
	 */
	getSubLogger(name: string): ILogger {
		const newParentNames = [...this.parentNames];
		if (this.loggerName) {
			newParentNames.push(this.loggerName);
		}
		const subLogger = new VSCodeLogger(this.outputChannel, this.extensionMode, name, newParentNames);
		subLogger.setLogLevel(this.logLevel);
		return subLogger;
	}

	trace(message: string, ...args: any[]): void {
		if (this.logLevel > LogLevel.TRACE) {return;}
		const formattedMessage = this.formatMessageWithHierarchy(message, ...args);
		this.outputChannel.trace(formattedMessage);
		this.autoShowInDevelopment();
	}

	debug(message: string, ...args: any[]): void {
		if (this.logLevel > LogLevel.DEBUG) {return;}
		const formattedMessage = this.formatMessageWithHierarchy(message, ...args);
		this.outputChannel.debug(formattedMessage);
		this.autoShowInDevelopment();
	}

	info(message: string, ...args: any[]): void {
		if (this.logLevel > LogLevel.INFO) {return;}
		const formattedMessage = this.formatMessageWithHierarchy(message, ...args);
		this.outputChannel.info(formattedMessage);
		this.autoShowInDevelopment();
	}

	warn(message: string, ...args: any[]): void {
		if (this.logLevel > LogLevel.WARN) {return;}
		const formattedMessage = this.formatMessageWithHierarchy(message, ...args);
		this.outputChannel.warn(formattedMessage);
		this.autoShowInDevelopment();
	}

	error(message: string, ...args: any[]): void {
		if (this.logLevel > LogLevel.ERROR) {return;}
		const formattedMessage = this.formatMessageWithHierarchy(message, ...args);
		this.outputChannel.error(formattedMessage);
		this.autoShowInDevelopment();
	}

	private formatMessage(message: string, ...args: any[]): string {
		if (args.length === 0) {
			return message;
		}
        
		const formattedArgs = args.map(arg => 
			typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
		).join(' ');
        
		return `${message} ${formattedArgs}`;
	}

	private formatMessageWithHierarchy(message: string, ...args: any[]): string {
		const className = this.getClassName();
		const hierarchicalName = this.getHierarchicalName();
		const prefix = hierarchicalName ? `[${hierarchicalName}]` : (className ? `[${className}]` : '[Unknown]');
		return this.formatMessage(`${prefix} ${message}`, ...args);
	}

	private getHierarchicalName(): string {
		if (!this.loggerName && this.parentNames.length === 0) {
			return '';
		}
		const parts = [...this.parentNames];
		if (this.loggerName) {
			parts.push(this.loggerName);
		}
		return parts.join(':');
	}

	private getClassName(): string {
		const err = new Error();
		const stack = err.stack?.split('\n');
        
		if (!stack || stack.length < 3) {
			return '<empty stack>';
		}
        
		// In our logger, the call stack looks like:
		// 0: Error
		// 1: getClassName 
		// 2: formatMessageWithCaller
		// 3: trace/debug/info/warn/error method
		// 4: ACTUAL CALLING CLASS <- This is what we want
        
		// Look specifically at frame 4 first (the direct caller)
		if (stack.length >= 5) {
			const directCallerFrame = stack[4];
			const className = this.extractClassNameFromFrame(directCallerFrame);
			if (className && !this.isGenericClassName(className)) {
				if(className === '') {return '<no-class-found>';}
				return className;
			}
		}
        
		// If frame 4 doesn't give us a good class name, search nearby frames
		for (let i = 3; i < Math.min(stack.length, 8); i++) {
			const line = stack[i];
			const className = this.extractClassNameFromFrame(line);
			if (className && !this.isGenericClassName(className)) {
				if(className === '') {return '<no-class-found>';}
				return className;
			}
		}
        
		return '<no-class-found>';
	}

	private extractClassNameFromFrame(frame: string): string {
		// Try multiple patterns to match class names in stack traces
        
		// Pattern 1: "at ClassName.methodName" or "at new ClassName" 
		let classMatch = frame.match(/at\s+(?:new\s+)?([A-Z][a-zA-Z0-9_]*)\./);
		if (classMatch) {
			return classMatch[1];
		}
        
		// Pattern 2: "at Object.ClassName" (for static methods)
		classMatch = frame.match(/at\s+Object\.([A-Z][a-zA-Z0-9_]*)/);
		if (classMatch) {
			return classMatch[1];
		}
        
		// Pattern 3: Extract from file paths - look for class names in TypeScript file names
		classMatch = frame.match(/([a-z][a-z-]*[a-z])\.ts:\d+:\d+/);
		if (classMatch) {
			// Convert kebab-case to PascalCase (e.g., "unified-session-data-service" -> "UnifiedSessionDataService")
			const fileName = classMatch[1];
			// Handle special case for "extension.ts" -> "RememberMcpManager" 
			if (fileName === 'extension') {
				return 'RememberMcpManager';
			}
			const pascalCase = fileName.split('-').map(word => 
				word.charAt(0).toUpperCase() + word.slice(1)
			).join('');
			return pascalCase;
		}
        
		// Pattern 4: Extract from webpack bundles - look for class names in file paths
		classMatch = frame.match(/([A-Z][a-zA-Z0-9_]+(?:Scanner|Manager|Service|Panel|Transformer|Engine|Watcher|Controller))/);
		if (classMatch) {
			return classMatch[1];
		}
        
		// Pattern 5: Generic class pattern with method call
		classMatch = frame.match(/([A-Z][a-zA-Z0-9_]+)\.[a-zA-Z_][a-zA-Z0-9_]*\s*\(/);
		if (classMatch) {
			return classMatch[1];
		}
        
		return '';
	}

	private isGenericClassName(className: string): boolean {
		const genericNames = [
			'VSCodeLogger', 'ConsoleLogger', 'SilentLogger',
			'Array', 'Object', 'Function', 'Module', 'Promise',
			'TracingChannel', 'EventEmitter', 'Timer'
		];
		return genericNames.includes(className);
	}

	private autoShowInDevelopment(): void {
		// Only auto-show once per session in development mode
		if (this.extensionMode === vscode.ExtensionMode.Development && !this.hasShownChannel) {
			this.outputChannel.show(true); // preserveFocus = true to be less intrusive
			this.hasShownChannel = true;
		}
	}
}
