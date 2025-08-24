/**
 * Component contracts for Model-View-Component architecture.
 * Components are self-contained units that manage their own state, rendering, and interactions.
 */

import * as vscode from 'vscode';

/**
 * Message that can be sent to components from the webview
 */
export interface ComponentMessage {
	type: string;
	[key: string]: any;
}

/**
 * Component interface for simplified architecture
 * Components render HTML directly and handle their own messages
 */
export interface IComponent {
	/**
	 * Unique identifier for this component
	 */
	readonly componentId: string;

	/**
	 * Render the component's HTML directly
	 */
	render(): string;

	/**
	 * Handle messages from the webview that are relevant to this component
	 * @param message The message to handle
	 * @returns true if the message was handled, false otherwise
	 */
	handleMessage(message: ComponentMessage): Promise<boolean>;

	/**
	 * Dispose of the component and clean up subscriptions
	 */
	dispose(): void;
}

/**
 * Base class that components can extend for common functionality
 */
export abstract class ComponentBase implements IComponent {
	protected _disposables: vscode.Disposable[] = [];

	constructor(
		public readonly componentId: string
	) {}

	/**
	 * Render the component's HTML directly
	 */
	abstract render(): string;

	/**
	 * Handle messages - components can override this for their specific logic
	 */
	async handleMessage(_message: ComponentMessage): Promise<boolean> {
		// Default implementation does nothing
		return false;
	}

	dispose(): void {
		this._disposables.forEach(d => d.dispose());
		this._disposables = [];
	}
}

/**
 * Legacy interfaces - keeping for backward compatibility during transition
 */
export interface ComponentView<TState = unknown, TActions = unknown> {
	/** Render HTML for this component. */
	render(state: TState): string;
	/** Bind actions so the component can reference callbacks if needed. */
	bind?(actions: TActions): void;
	/** Optional: Inline script to bind events inside the webview (kept tiny). */
	getClientInitScript?(): string;
}

export interface ComponentViewModel<TState = unknown, TEvent = unknown> {
	getState(): TState;
	subscribe(listener: (state: TState) => void): () => void;
	handle(event: TEvent): void;
}

export type Unsubscribe = () => void;
