/**
 * Component contracts for Model-View-Component architecture.
 * Components are self-contained units that manage their own state, rendering, and interactions.
 */

import * as vscode from 'vscode';
import { Logger } from '../../../../types/logger';

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
	protected logger = Logger.getInstance(`Component:${this.componentId}`);

	constructor(
		public readonly componentId: string
	) {
		this.logger.debug(`Component ${componentId} created`);
	}

	/**
	 * Render the component's HTML directly
	 */
	abstract render(): string;

	/**
	 * Handle messages - components can override this for their specific logic
	 */
	async handleMessage(_message: ComponentMessage): Promise<boolean> {
		this.logger.trace(`Component ${this.componentId} received message: ${_message.type}`);
		// Default implementation does nothing
		return false;
	}

	dispose(): void {
		this.logger.debug(`Disposing component ${this.componentId} with ${this._disposables.length} disposables`);
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

export type Unsubscribe = () => void;
