import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Shared webview utilities for consistent styling and functionality
 */
export class WebviewUtils {
	/**
     * Get the shared CSS styles for VS Code panels
     */
	public static async getSharedStyles(extensionUri: vscode.Uri): Promise<string> {
		try {
			const cssPath = path.join(extensionUri.fsPath, 'src', 'webview', 'shared', 'styles', 'panel.css');
			const cssContent = await fs.readFile(cssPath, 'utf8');
			return `<style>${cssContent}</style>`;
		} catch (error) {
			console.warn('Failed to load shared styles, using fallback:', error);
			return '<style>/* Fallback: shared styles not available */</style>';
		}
	}

	/**
     * Get standard webview JavaScript utilities
     */
	public static getSharedScript(): string {
		return `<script>
			// Acquire and cache the VS Code API once per webview document
			if (!window.vscode) {
				window.vscode = acquireVsCodeApi();
			}

			function sendMessage(type, data = {}) {
				window.vscode.postMessage({
					type: type,
					...data
				});
			}

			// Define a single global chart helper for all charts in the webview
			if (!window.__chartKit) {
				window.__chartKit = (function() {
					const instances = (window.__charts = window.__charts || {});
					let ready = typeof Chart !== 'undefined';
					const onReadyQueue = [];
					let uid = 0;

					function whenChartReady(cb) {
						if (typeof Chart !== 'undefined') {
							ready = true;
							cb();
							return;
						}
						onReadyQueue.push(cb);
						if (!ready) {
							const timer = setInterval(() => {
								if (typeof Chart !== 'undefined') {
									ready = true;
									clearInterval(timer);
									while (onReadyQueue.length) {
										try { onReadyQueue.shift()(); } catch (e) { console.error(e); }
									}
								}
							}, 100);
						}
					}

					function resolveVarViaCanvas(canvas, value) {
						if (typeof value !== 'string') return value;
						if (value.indexOf('var(') === -1) return value;
						const prevColor = canvas.style.color;
						canvas.style.color = value;
						let resolved = getComputedStyle(canvas).color;
						canvas.style.color = prevColor;
						if (resolved && resolved.trim() && resolved.indexOf('var(') === -1) return resolved;
						const prevFont = canvas.style.fontFamily;
						canvas.style.fontFamily = value;
						resolved = getComputedStyle(canvas).fontFamily;
						canvas.style.fontFamily = prevFont;
						return (resolved && resolved.trim() && resolved.indexOf('var(') === -1) ? resolved : value;
					}

					function deepResolve(canvas, input) {
						if (input == null) return input;
						const t = typeof input;
						if (t === 'string') return resolveVarViaCanvas(canvas, input);
						if (Array.isArray(input)) {
							for (let i = 0; i < input.length; i++) input[i] = deepResolve(canvas, input[i]);
							return input;
						}
						if (t === 'object') {
							for (const k in input) {
								if (!Object.prototype.hasOwnProperty.call(input, k)) continue;
								const v = input[k];
								if (typeof v === 'function') continue;
								input[k] = deepResolve(canvas, v);
							}
						}
						return input;
					}

					function getKeyForCanvas(canvas) {
						return canvas.id || (canvas.__chartKey || (canvas.__chartKey = 'c_' + (++uid)));
					}

					function render(canvasOrId, config) {
						const canvas = typeof canvasOrId === 'string' ? document.getElementById(canvasOrId) : canvasOrId;
						if (!canvas) return;
						const key = getKeyForCanvas(canvas);
						if (instances[key]) {
							try { instances[key].destroy(); } catch {}
						}
						const resolved = deepResolve(canvas, config);
						try {
							instances[key] = new Chart(canvas, resolved);
						} catch (e) {
							console.error('Chart render failed:', e);
						}
					}

					function destroy(canvasOrId) {
						const canvas = typeof canvasOrId === 'string' ? document.getElementById(canvasOrId) : canvasOrId;
						if (!canvas) return;
						const key = getKeyForCanvas(canvas);
						if (key && instances[key]) {
							try { instances[key].destroy(); } catch {}
							delete instances[key];
						}
					}

					function destroyAll() {
						for (const k in instances) {
							try { instances[k].destroy(); } catch {}
							delete instances[k];
						}
					}

					window.addEventListener('unload', destroyAll);

					return { whenChartReady, render, destroy, destroyAll, deepResolve, resolveVarViaCanvas };
				})();
			}
		</script>`;
	}

	/**
     * Escape HTML to prevent XSS
     */
	public static escapeHtml(text: string): string {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}
}
