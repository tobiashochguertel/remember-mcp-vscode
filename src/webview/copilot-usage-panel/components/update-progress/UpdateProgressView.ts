export interface UpdateProgressState {
	lastUpdateTime?: number;
	updateIntervalMs: number;
}

/**
 * View component for chat session update progress indicator
 * Shows a visual progress bar that tracks time until next chat session update
 */
export class UpdateProgressView {
	render(state: UpdateProgressState): string {
		const { lastUpdateTime, updateIntervalMs } = state;
		
		if (!lastUpdateTime) {
			return `
			<section class="card update-progress-card">
				<h3>Chat Session Updates</h3>
				<div class="summary">Waiting for first update...</div>
			</section>`;
		}

		const now = Date.now();
		const timeSinceUpdate = now - lastUpdateTime;
		const timeUntilNext = Math.max(0, updateIntervalMs - timeSinceUpdate);
		const progressPercent = Math.min(100, (timeSinceUpdate / updateIntervalMs) * 100);
		
		const secondsUntilNext = Math.ceil(timeUntilNext / 1000);
		const lastUpdateStr = new Date(lastUpdateTime).toLocaleTimeString();

		return `
		<section class="card update-progress-card">
			<h3>Chat Session Updates</h3>
			<div class="summary">Updates every ${Math.round(updateIntervalMs / 1000)} seconds • Last: ${lastUpdateStr}</div>
			<div class="progress-container">
				<div class="progress-bar">
					<div class="progress-fill" style="width: ${progressPercent}%"></div>
				</div>
				<div class="progress-text">
					${secondsUntilNext > 0 ? `Next update in ~${secondsUntilNext}s` : 'Update due now'}
				</div>
			</div>
		</section>`;
	}

	getClientInitScript(): string {
		return `
		(function(){
			// Auto-refresh progress every 5 seconds (since updates are every 60 seconds)
			let progressInterval;
			
			function startProgressUpdates() {
				if (progressInterval) clearInterval(progressInterval);
				
				progressInterval = setInterval(() => {
					// Request fresh data from extension
					sendMessage('requestProgressUpdate');
				}, 5000); // Update every 5 seconds
			}
			
			function stopProgressUpdates() {
				if (progressInterval) {
					clearInterval(progressInterval);
					progressInterval = null;
				}
			}
			
			// Start updates when page loads
			startProgressUpdates();
			
			// Clean up on page unload
			window.addEventListener('beforeunload', stopProgressUpdates);
			
			// Expose for debugging
			window.progressUpdates = { start: startProgressUpdates, stop: stopProgressUpdates };
		})();
		`;
	}

	/**
	 * Get CSS styles for the progress bar component
	 */
	getStyles(): string {
		return `
		.update-progress-card {
			margin-bottom: 12px;
		}

		.progress-container {
			margin-top: 8px;
		}

		.progress-bar {
			width: 100%;
			height: 6px;
			background-color: var(--vscode-progressBar-background, var(--vscode-widget-shadow));
			border-radius: 3px;
			overflow: hidden;
			position: relative;
			margin-bottom: 4px;
		}

		.progress-fill {
			height: 100%;
			background: linear-gradient(90deg, 
				var(--vscode-progressBar-background, #007acc) 0%,
				var(--vscode-button-background, #0078d4) 50%,
				var(--vscode-charts-orange, #f59100) 100%
			);
			border-radius: 3px;
			transition: width 0.3s ease-out;
			position: relative;
		}

		.progress-fill::after {
			content: '';
			position: absolute;
			top: 0;
			left: 0;
			right: 0;
			bottom: 0;
			background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.2) 50%, transparent 100%);
			animation: progress-shine 2s ease-in-out infinite;
		}

		@keyframes progress-shine {
			0% { transform: translateX(-100%); }
			100% { transform: translateX(100%); }
		}

		.progress-text {
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			text-align: center;
			margin-top: 2px;
		}

		/* Pulse animation when near completion */
		.progress-fill[data-near-complete] {
			animation: progress-pulse 1s ease-in-out infinite alternate;
		}

		@keyframes progress-pulse {
			0% { opacity: 1; }
			100% { opacity: 0.7; }
		}
		`;
	}
}