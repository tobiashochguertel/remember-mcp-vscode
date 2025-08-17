import { ComponentView } from '../shared/ComponentBase';

export interface DailyRequestsChartRenderState {
	labels: string[];
	data: number[];
	isLoading: boolean;
	isEmpty: boolean;
}

/**
 * View component for daily requests bar chart
 * Renders Chart.js bar chart showing requests per day
 */
export class DailyRequestsChartView implements ComponentView<DailyRequestsChartRenderState, never> {
	render(state: DailyRequestsChartRenderState): string {
		if (state.isLoading) {
			return `
				<section class="daily-requests-chart">
					<h4>Daily Requests</h4>
					<div class="chart-container" style="position: relative; height: 200px; text-align: center; display: flex; align-items: center; justify-content: center;">
						<div style="color: var(--vscode-descriptionForeground);">Loading chart...</div>
					</div>
				</section>
			`;
		}

		if (state.isEmpty) {
			return `
				<section class="daily-requests-chart">
					<h4>Daily Requests</h4>
					<div class="chart-container" style="position: relative; height: 200px; text-align: center; display: flex; align-items: center; justify-content: center;">
						<div style="color: var(--vscode-descriptionForeground);">No data available</div>
					</div>
				</section>
			`;
		}

		const canvasId = 'dailyRequestsChart';
		// Build chart config in TypeScript (use CSS var tokens; they'll be resolved in the webview)
		const datasetColorToken = 'var(--vscode-charts-blue)';
		const chartConfig = {
			type: 'bar',
			data: {
				labels: state.labels,
				datasets: [
					{
						label: 'Requests',
						data: state.data,
						backgroundColor: datasetColorToken,
						borderColor: datasetColorToken,
						borderWidth: 1,
						borderRadius: 2,
						borderSkipped: false,
						hoverBackgroundColor: datasetColorToken,
						hoverBorderColor: datasetColorToken,
						hoverBorderWidth: 2
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				plugins: {
					legend: { display: false },
					tooltip: {
						mode: 'index',
						intersect: false,
						backgroundColor: 'var(--vscode-editorHoverWidget-background)',
						borderColor: 'var(--vscode-editorHoverWidget-border)',
						borderWidth: 1,
						titleColor: 'var(--vscode-editorHoverWidget-foreground)',
						bodyColor: 'var(--vscode-editorHoverWidget-foreground)',
						callbacks: {
							title: function (context: any[]) { 
								return context[0].label; 
							},
							label: function (context: any) { 
								const v = context.parsed.y; return 'Requests: ' + v; 
							}
						}
					}
				},
				scales: {
					x: {
						display: true,
						grid: { display: false },
						ticks: { color: 'var(--vscode-foreground)', 
							maxRotation: 45, 
							minRotation: 0, 
							font: { 
								size: 11, 
								family: 'var(--vscode-font-family)' 
							}
						}
					},
					y: { 
						display: true, 
						beginAtZero: true,
						grid: { 
							color: 'var(--vscode-panel-border)', 
							borderDash: [2, 2] }, 
						ticks: { color: 'var(--vscode-foreground)', 
							precision: 0, 
							font: { 
								size: 11,
								family: 'var(--vscode-font-family)'
							} 
						}
					}
				},
				interaction: { mode: 'nearest', axis: 'x', intersect: false },
				animation: { duration: 750, easing: 'easeInOutQuart' }
			}
		};

		return `
			<section class="daily-requests-chart">
				<h4>Daily Requests</h4>
				<div class="chart-container" style="
					position: relative; 
					height: 200px; 
					margin: 8px 0; 
					padding: 8px;
					background-color: var(--vscode-panel-background);
					border: 1px solid var(--vscode-panel-border);
					border-radius: 4px;
				">
					<canvas id="${canvasId}"></canvas>
				</div>
				<script>
					(function() {
						const init = () => {
							if (typeof Chart === 'undefined') {
								setTimeout(init, 100);
								return;
							}

							const canvas = document.getElementById('${canvasId}');
							if (!canvas) {
								return;
							}

							// Manage chart instance per-canvas to avoid cross-chart interference
							const charts = (window.__charts = window.__charts || {});
							const instanceKey = canvas.id;
							if (charts[instanceKey]) {
								charts[instanceKey].destroy();
							}

							function resolveVarViaCanvas(value) {
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

							function deepReplaceCssVars(input) {
								if (input == null) return input;
								const t = typeof input;
								if (t === 'string') {
									return resolveVarViaCanvas(input);
								}
								if (Array.isArray(input)) {
									for (let i = 0; i < input.length; i++) {
										input[i] = deepReplaceCssVars(input[i]);
									}
									return input;
								}
								if (t === 'object') {
									for (const k in input) {
										if (!Object.prototype.hasOwnProperty.call(input, k)) continue;
										const v = input[k];
										if (typeof v === 'function') continue;
										input[k] = deepReplaceCssVars(v);
									}
								}
								return input;
							}

							const config = ${JSON.stringify(chartConfig)};
							if (config && config.options && config.options.plugins && config.options.plugins.tooltip) {
								config.options.plugins.tooltip.callbacks = {
									title: function(context) { return context[0].label; },
									label: function(context) { const v = context.parsed.y; return 'Requests: ' + v; }
								};
							}

							const resolvedConfig = deepReplaceCssVars(config);

							try {
								charts[instanceKey] = new Chart(canvas, resolvedConfig);
							} catch (error) {
								console.error('Failed to create daily requests chart:', error);
							}
						};

						init();
					})();
				</script>
			</section>
		`;
	}
}
