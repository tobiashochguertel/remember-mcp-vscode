/**
 * Component Model Framework Interface
 * Defines the contract for component models in the usage history panel
 */

import type { GlobalFilters } from '../../copilot-usage-history-model';

/**
 * Base interface for all component models
 */
export interface IComponentModel {
	/**
	 * Unique identifier for this component model
	 */
	readonly id: string;

	/**
	 * Refresh the component's data based on current filters
	 * @param filters Current global filters
	 */
	refresh(filters: GlobalFilters): Promise<void>;

	/**
	 * Dispose of the model and clean up resources
	 */
	dispose(): void;

	/**
	 * Check if the model is currently loading data
	 */
	isLoading(): boolean;
}