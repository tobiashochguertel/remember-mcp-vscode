/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Niclas Olofsson. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

/**
 * Mock implementation of VS Code API for testing
 * This provides minimal mocks for the most commonly used VS Code APIs
 */

export enum ExtensionKind {
	UI = 1,
	Workspace = 2
}

export enum ExtensionMode {
	Production = 1,
	Development = 2,
	Test = 3
}

export class Uri {
	static file(path: string): Uri {
		return new Uri('file', '', path, '', '');
	}

	static parse(value: string): Uri {
		const match = value.match(/^(\w+):\/\/([^/]*)(\/[^?]*)?(\?[^#]*)?(#.*)?$/);
		if (!match) {
			throw new Error(`Invalid URI: ${value}`);
		}
		return new Uri(match[1], match[2], match[3] || '', match[4] || '', match[5] || '');
	}

	constructor(
		public scheme: string,
		public authority: string,
		public path: string,
		public query: string,
		public fragment: string
	) {}

	get fsPath(): string {
		return this.path;
	}

	toString(): string {
		return `${this.scheme}://${this.authority}${this.path}${this.query}${this.fragment}`;
	}
}

export class EventEmitter<_T> {
	private listeners: Array<(e: _T) => any> = [];

	get event() {
		return (listener: (e: _T) => any) => {
			this.listeners.push(listener);
			return {
				dispose: () => {
					const index = this.listeners.indexOf(listener);
					if (index > -1) {
						this.listeners.splice(index, 1);
					}
				}
			};
		};
	}

	fire(data: _T): void {
		this.listeners.forEach(listener => listener(data));
	}

	dispose(): void {
		this.listeners = [];
	}
}

export class CancellationTokenSource {
	token: any = {
		isCancellationRequested: false,
		onCancellationRequested: () => ({ dispose: () => {} })
	};

	cancel(): void {
		this.token.isCancellationRequested = true;
	}

	dispose(): void {
		// no-op
	}
}

export enum ConfigurationTarget {
	Global = 1,
	Workspace = 2,
	WorkspaceFolder = 3
}

export class WorkspaceConfiguration {
	private values: Map<string, any> = new Map();

	get<T>(section: string, defaultValue?: T): T | undefined {
		return this.values.get(section) ?? defaultValue;
	}

	has(section: string): boolean {
		return this.values.has(section);
	}

	update(section: string, value: any): Promise<void> {
		this.values.set(section, value);
		return Promise.resolve();
	}

	inspect(section: string): any {
		return {
			key: section,
			defaultValue: undefined,
			globalValue: this.values.get(section)
		};
	}
}

export namespace workspace {
	export const workspaceFolders: any[] = [];
	export const fs: any = {};
	
	export function getConfiguration(_section?: string): WorkspaceConfiguration {
		return new WorkspaceConfiguration();
	}

	export function onDidChangeConfiguration(_listener: any): any {
		return { dispose: () => {} };
	}

	export function createFileSystemWatcher(_pattern: string): any {
		return {
			onDidCreate: () => ({ dispose: () => {} }),
			onDidChange: () => ({ dispose: () => {} }),
			onDidDelete: () => ({ dispose: () => {} }),
			dispose: () => {}
		};
	}
}

export namespace window {
	export function showInformationMessage(_message: string, ..._items: any[]): Promise<any> {
		return Promise.resolve(undefined);
	}

	export function showWarningMessage(_message: string, ..._items: any[]): Promise<any> {
		return Promise.resolve(undefined);
	}

	export function showErrorMessage(_message: string, ..._items: any[]): Promise<any> {
		return Promise.resolve(undefined);
	}

	export function createOutputChannel(_name: string): any {
		return {
			append: () => {},
			appendLine: () => {},
			clear: () => {},
			show: () => {},
			hide: () => {},
			dispose: () => {}
		};
	}

	export function createStatusBarItem(_alignment?: any, _priority?: number): any {
		return {
			text: '',
			tooltip: '',
			command: '',
			show: () => {},
			hide: () => {},
			dispose: () => {}
		};
	}

	export function createWebviewPanel(
		_viewType: string,
		_title: string,
		_showOptions: any,
		_options?: any
	): any {
		return {
			webview: {
				html: '',
				onDidReceiveMessage: () => ({ dispose: () => {} }),
				postMessage: () => Promise.resolve(true)
			},
			onDidDispose: () => ({ dispose: () => {} }),
			reveal: () => {},
			dispose: () => {}
		};
	}

	export const activeTextEditor: any = undefined;
	export const visibleTextEditors: any[] = [];
}

export namespace commands {
	export function registerCommand(_command: string, _callback: (...args: any[]) => any): any {
		return { dispose: () => {} };
	}

	export function executeCommand(_command: string, ..._args: any[]): Promise<any> {
		return Promise.resolve(undefined);
	}
}

export namespace env {
	export const appName = 'Visual Studio Code';
	export const appRoot = '/mock/vscode';
	export const language = 'en';
	export const clipboard: any = {
		readText: () => Promise.resolve(''),
		writeText: () => Promise.resolve()
	};
}

export namespace extensions {
	export function getExtension(_extensionId: string): any {
		return undefined;
	}

	export const all: any[] = [];
}

export class Disposable {
	static from(...disposables: { dispose(): any }[]): Disposable {
		return new Disposable(() => {
			disposables.forEach(d => d.dispose());
		});
	}

	constructor(private callOnDispose: () => any) {}

	dispose(): any {
		return this.callOnDispose();
	}
}

export enum StatusBarAlignment {
	Left = 1,
	Right = 2
}

export enum ViewColumn {
	Active = -1,
	Beside = -2,
	One = 1,
	Two = 2,
	Three = 3
}

export enum ProgressLocation {
	SourceControl = 1,
	Window = 10,
	Notification = 15
}

export class Range {
	constructor(
		public start: any,
		public end: any
	) {}
}

export class Position {
	constructor(
		public line: number,
		public character: number
	) {}
}

export class Selection extends Range {
	constructor(
		public anchor: Position,
		public active: Position
	) {
		super(anchor, active);
	}
}

export class TreeItem {
	constructor(
		public label: string,
		public collapsibleState?: any
	) {}
}

export enum TreeItemCollapsibleState {
	None = 0,
	Collapsed = 1,
	Expanded = 2
}

// Add any other VS Code API mocks as needed
