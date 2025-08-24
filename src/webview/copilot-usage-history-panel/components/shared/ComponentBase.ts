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
 * Component interface for the new architecture
 * Each component manages its own lifecycle, rendering, and message handling
 */
export interface IComponent {
	/**
	 * Unique identifier for this component's DOM container
	 */
	readonly componentId: string;

	/**
	 * Handle messages from the webview that are relevant to this component
	 * @param message The message to handle
	 * @returns true if the message was handled, false otherwise
	 */
	handleMessage(message: ComponentMessage): Promise<boolean>;

	/**
	 * Get client-side JavaScript for this component (if needed)
	 */
	getClientScript?(): string;

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
		protected readonly webview: vscode.Webview,
		public readonly componentId: string
	) {}

	abstract handleMessage(message: ComponentMessage): Promise<boolean>;

	/**
	 * Update this component's HTML in the webview via PostMessage
	 */
	protected updateView(html: string): void {
		this.webview.postMessage({
			type: 'component-update',
			componentId: this.componentId,
			html: html
		});
	}

	/**
	 * Render the component's HTML - now protected since components update themselves
	 */
	protected abstract render(): string;

	getClientScript?(): string;

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
