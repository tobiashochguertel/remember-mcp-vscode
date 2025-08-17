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
		
		// Prepare data for Chart.js
		const chartData = JSON.stringify({
			labels: state.labels,
			datasets: [{
				label: 'Requests',
				data: state.data,
				backgroundColor: 'rgba(14, 99, 156, 0.8)', // button.background
				borderColor: 'rgba(7, 9, 11, 1)', // VS Code blue
				borderWidth: 1,
				borderRadius: 2,
				borderSkipped: false,
				hoverBackgroundColor: 'rgba(14, 99, 156, 0.9)',
				hoverBorderColor: 'rgba(14, 99, 156, 1)',
				hoverBorderWidth: 2
			}]
		});

		const chartOptions = JSON.stringify({
			responsive: true,
			maintainAspectRatio: false,
			plugins: {
				legend: {
					display: false
				},
				tooltip: {
					mode: 'index',
					intersect: false,
					backgroundColor: 'var(--vscode-editorHoverWidget-background)',
					borderColor: 'var(--vscode-editorHoverWidget-border)',
					borderWidth: 1,
					titleColor: 'var(--vscode-editorHoverWidget-foreground)',
					bodyColor: 'var(--vscode-editorHoverWidget-foreground)',
					callbacks: {
						title: function(context: any) {
							return context[0].label;
						},
						label: function(context: any) {
							const value = context.parsed.y;
							return `Requests: ${value}`;
						}
					}
				}
			},
			scales: {
				x: {
					display: true,
					grid: {
						display: false
					},
					ticks: {
						color: 'var(--vscode-foreground)',
						font: {
							size: 11,
							family: 'var(--vscode-font-family)'
						},
						maxRotation: 45,
						minRotation: 0
					}
				},
				y: {
					display: true,
					beginAtZero: true,
					grid: {
						color: 'var(--vscode-panel-border)',
						borderDash: [2, 2]
					},
					ticks: {
						color: 'var(--vscode-foreground)',
						font: {
							size: 11,
							family: 'var(--vscode-font-family)'
						},
						precision: 0
					}
				}
			},
			interaction: {
				mode: 'nearest',
				axis: 'x',
				intersect: false
			},
			animation: {
				duration: 750,
				easing: 'easeInOutQuart'
			}
		});

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
						// Wait for Chart.js to be available
						if (typeof Chart === 'undefined') {
							console.warn('Chart.js not loaded yet, retrying...');
							setTimeout(arguments.callee, 100);
							return;
						}

						const ctx = document.getElementById('${canvasId}');
						if (!ctx) {
							console.warn('Canvas element not found: ${canvasId}');
							return;
						}

						// Destroy existing chart if it exists
						if (window.dailyRequestsChartInstance) {
							window.dailyRequestsChartInstance.destroy();
						}

						// Get computed styles for dynamic theming
						const computedStyle = getComputedStyle(document.body);
						const foregroundColor = computedStyle.getPropertyValue('--vscode-foreground').trim();
						const borderColor = computedStyle.getPropertyValue('--vscode-panel-border').trim();
						const chartAccentColor = computedStyle.getPropertyValue('--vscode-charts-blue') || 'rgba(0, 122, 204, 1)';

						// Create new chart
						try {
							window.dailyRequestsChartInstance = new Chart(ctx, {
								type: 'bar',
								data: ${chartData},
								options: ${chartOptions}
							});
						} catch (error) {
							console.error('Failed to create daily requests chart:', error);
						}
					})();
				</script>
			</section>
		`;
	}
}
