import * as vscode from 'vscode';
import { ComponentBase, ComponentMessage } from '../shared/ComponentBase';
import { DailyRequestsChartViewModel } from './DailyRequestsChartViewModel';
import { ILogger } from '../../../../types/logger';

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
export class DailyRequestsChartView extends ComponentBase {
	private viewModel: DailyRequestsChartViewModel;

	constructor(
		webview: vscode.Webview,
		private model: any, // Model reference for accessing viewModel
		private logger: ILogger
	) {
		super(webview, 'daily-requests-chart-container');
		this.viewModel = this.model.dailyRequestsChartViewModel;

		// Subscribe to model changes and update when data changes
		this.viewModel.onDidChange(() => {
			this.onStateChanged();
		});

		// Don't send initial content immediately - wait for refreshComponentViews()
		// this.onStateChanged();
	}

	/**
	 * Handle messages relevant to daily requests chart
	 */
	protected async handleComponentMessage(_message: ComponentMessage): Promise<boolean> {
		// Chart is read-only, so they don't handle any specific messages
		// They update automatically when the model changes
		return false;
	}

	/**
	 * Render the daily requests chart HTML
	 */
	public render(): string {
		const vmState = this.viewModel.getState();

		if (vmState.isLoading) {
			return `
				<section class="daily-requests-chart">
					<h4>Daily Requests</h4>
					<div class="chart-container" style="position: relative; height: 200px; text-align: center; display: flex; align-items: center; justify-content: center;">
						<div style="color: var(--vscode-descriptionForeground);">Loading chart...</div>
					</div>
				</section>
			`;
		}

		if (vmState.isEmpty) {
			return `
				<section class="daily-requests-chart">
					<h4>Daily Requests</h4>
					<div class="chart-container" style="position: relative; height: 200px; text-align: center; display: flex; align-items: center; justify-content: center;">
						<div style="color: var(--vscode-descriptionForeground);">No data available</div>
					</div>
				</section>
			`;
		}

		// Transform ViewModel data to Chart.js format
		const labels = vmState.data.map(item => item.date);
		const chartData = vmState.data.map(item => item.requests);

		const canvasId = 'dailyRequestsChart';
		// Build chart config in TypeScript (use CSS var tokens; they'll be resolved in the webview)
		const datasetColorToken = 'var(--vscode-charts-blue)';
		const chartConfig = {
			type: 'bar',
			data: {
				labels: labels,
				datasets: [
					{
						label: 'Requests',
						data: chartData,
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
						display: false,
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
						display: false, 
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
				<h4>Daily Requests</h4>
				<div class="chart-container panel-section" style="height: 100px; position: relative;">
					<canvas id="${canvasId}" style="touch-action: manipulation;"></canvas>
				</div>
				<script>
					(function() {
						console.log('DailyRequestsChart: Script executing for canvas ${canvasId}');
						
						// Build and render this specific chart using the shared helper
						const boot = () => {
							console.log('DailyRequestsChart: Boot function called');
							const canvas = document.getElementById('${canvasId}');
							if (!canvas) {
								console.error('DailyRequestsChart: Canvas ${canvasId} not found');
								return;
							}

							const config = ${JSON.stringify(chartConfig)};
							console.log('DailyRequestsChart: Config prepared', config);

							if (window.__chartKit) {
								console.log('DailyRequestsChart: Using __chartKit to render');
								window.__chartKit.render(canvas, config);
							} else {
								console.warn('DailyRequestsChart: __chartKit not available, waiting...');
								// Fallback wait until shared script loads
								const wait = setInterval(() => {
									if (window.__chartKit) {
										clearInterval(wait);
										console.log('DailyRequestsChart: __chartKit now available, rendering');
										window.__chartKit.render(canvas, config);
									}
								}, 50);
								
								// Timeout after 5 seconds
								setTimeout(() => {
									clearInterval(wait);
									console.error('DailyRequestsChart: Timeout waiting for __chartKit');
								}, 5000);
							}
						};

						// If Chart.js may not be ready yet, utilize helper's whenChartReady when present
						if (window.__chartKit && window.__chartKit.whenChartReady) {
							console.log('DailyRequestsChart: Using whenChartReady');
							window.__chartKit.whenChartReady(boot);
						} else {
							console.log('DailyRequestsChart: Calling boot directly');
							boot();
						}
					})();
				</script>
			</section>
		`;
	}

	/**
	 * Called when the model state changes - component updates itself
	 */
	private onStateChanged(): void {
		const html = this.render();
		this.updateView(html);
	}
}
