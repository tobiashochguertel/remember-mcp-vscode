import * as vscode from 'vscode';
import { ComponentBase, ComponentMessage } from '../shared/ComponentBase';
import { DailyRequestsChartComponentModel } from './DailyRequestsChartComponentModel';
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
	private viewModel: DailyRequestsChartComponentModel;

	constructor(
		private webview: vscode.Webview,
		componentModel: DailyRequestsChartComponentModel,
		private logger: ILogger
	) {
		super('daily-requests-chart-container');
		this.viewModel = componentModel;

		// Subscribe to model changes - component will be re-rendered when view calls render()
		this.viewModel.onDidChange(() => {
			// Component will be re-rendered when the view calls render()
		});
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

		// Get chart data from the component model
		const chartData = this.viewModel.getChartData();

		const canvasId = 'dailyRequestsChart';
		// Build chart config in TypeScript (use CSS var tokens; they'll be resolved in the webview)
		const datasetColorToken = 'var(--vscode-charts-blue)';
		const chartConfig = {
			type: 'bar',
			data: {
				labels: chartData.labels,
				datasets: [
					{
						label: 'Requests',
						data: chartData.data,
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
						const canvas = document.getElementById('${canvasId}');
						if (!canvas) {
							console.error('DailyRequestsChart: Canvas ${canvasId} not found');
							return;
						}

						const config = ${JSON.stringify(chartConfig)};
						
						// Use the shared chart kit helper for proper Chart.js integration
						if (window.__chartKit) {
							window.__chartKit.render(canvas, config);
						} else {
							console.error('DailyRequestsChart: __chartKit not available');
						}
					})();
				</script>
			</section>
		`;
	}

}
