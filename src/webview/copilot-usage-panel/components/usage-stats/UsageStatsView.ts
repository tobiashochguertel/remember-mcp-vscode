import { WebviewUtils } from '../../../shared/webview-utils';
import { UsageStatItem } from './UsageStatsViewModel';
import { Logger } from '../../../../types/logger';

export type UsageStatsRenderState = { stats: UsageStatItem[]; total: number };

export class UsageStatsView {
	private logger = Logger.getInstance('UsageStatsView');

	render(state: UsageStatsRenderState): string {
		this.logger.trace(`Rendering usage stats: ${state.stats.length} items, total ${state.total} requests`);
		
		const rows = state.stats.length
			? state.stats.map(({ model, count, updated }) => `<tr${updated ? ' class=\"flash-row\"' : ''}><td>${WebviewUtils.escapeHtml(model)}</td><td class=\"count\">${count}</td></tr>`).join('')
			: '<tr><td colspan=\"2\" class=\"no-data\">No usage data available<br/>Start using Copilot to track usage</td></tr>';

		return `
    <section class=\"card\">\n\t\t\t<h2>Model usage (Current workspace)</h2>\n\t\t\t<div class=\"summary\">Total: ${state.total} requests</div>\n\t\t\t<table>\n\t\t\t\t<thead>\n\t\t\t\t\t<tr>\n\t\t\t\t\t\t<th>Model</th>\n\t\t\t\t\t\t<th style=\"text-align:right;\">Count</th>\n\t\t\t\t\t</tr>\n\t\t\t\t</thead>\n\t\t\t\t<tbody>\n\t\t\t\t\t${rows}\n\t\t\t\t</tbody>\n\t\t\t</table>\n\t\t\t<div class=\"actions\">\n\t\t\t\t<button class=\"secondary\" id=\"btnClearStats\" ${state.stats.length ? '' : 'disabled'}>Clear</button>\n\t\t\t</div>\n\t\t</section>`;
	}

	getClientInitScript(): string {
		return `
    (function(){
      const clearBtn = document.getElementById('btnClearStats');
      if (clearBtn) clearBtn.addEventListener('click', () => sendMessage('clearStats'));
      // Flash updated rows
      document.querySelectorAll('.flash-row').forEach(row => {
        setTimeout(() => row.classList.remove('flash-row'), 800);
      });
    })();
    `;
	}
}
