/**
 * Lightweight component contracts for micro‑MVVM composition inside the webview panel.
 * These run on the extension side to generate HTML fragments that the webview renders.
 * Keep logic minimal and UI-native (VS Code theme tokens only).
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
