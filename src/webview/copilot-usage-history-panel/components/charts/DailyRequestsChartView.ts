import { ComponentView } from '../shared/ComponentBase';

export interface DailyRequestsChartRenderState {
	labels: string[];
	data: number[];
	isLoading: boolean;
	isEmpty: boolean;
	/** Optional section title; defaults to "Daily Requests" */
	title?: string;
	/** Optional dataset/series label; defaults to "Requests" */
	seriesLabel?: string;
	/** Optional loading text; defaults to "Loading chart..." */
	loadingText?: string;
	/** Optional empty state text; defaults to "No data available" */
	emptyText?: string;
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
					<h4>${state.title ?? 'Daily Requests'}</h4>
					<div class="chart-container" style="position: relative; height: 200px; text-align: center; display: flex; align-items: center; justify-content: center;">
						<div style="color: var(--vscode-descriptionForeground);">${state.loadingText ?? 'Loading chart...'}</div>
					</div>
				</section>
			`;
		}

		if (state.isEmpty) {
			return `
				<section class="daily-requests-chart">
					<h4>${state.title ?? 'Daily Requests'}</h4>
					<div class="chart-container" style="position: relative; height: 200px; text-align: center; display: flex; align-items: center; justify-content: center;">
						<div style="color: var(--vscode-descriptionForeground);">${state.emptyText ?? 'No data available'}</div>
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
						label: state.seriesLabel ?? 'Requests',
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
				// Limit to mouse/click events to avoid non-passive touch listeners in Chrome warnings
				events: ['mousemove', 'mouseout', 'click'],
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
						bodyColor: 'var(--vscode-editorHoverWidget-foreground)'
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
			<section class="daily-requests-chart panel-section">
				<h4>${state.title ?? 'Daily Requests'}</h4>
				<div class="chart-container panel-section" style="height: 200px; position: relative;">
					<canvas id="${canvasId}" style="touch-action: manipulation;"></canvas>
				</div>
				<script>
					(function() {
						// Build and render this specific chart using the shared helper
						const boot = () => {
							const canvas = document.getElementById('${canvasId}');
							if (!canvas) return;

							const config = ${JSON.stringify(chartConfig)};

							if (window.__chartKit) {
								window.__chartKit.render(canvas, config);
							} else {
								// Fallback wait until shared script loads
								const wait = setInterval(() => {
									if (window.__chartKit) {
										clearInterval(wait);
										window.__chartKit.render(canvas, config);
									}
								}, 50);
							}
						};

						// If Chart.js may not be ready yet, utilize helper's whenChartReady when present
						if (window.__chartKit && window.__chartKit.whenChartReady) {
							window.__chartKit.whenChartReady(boot);
						} else {
							boot();
						}
					})();
				</script>
			</section>
		`;
	}
}
