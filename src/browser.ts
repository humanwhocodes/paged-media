/**
 * @fileoverview Browser bundle entry point. Exposes the API on
 * `window.PagedMedia` and runs the polyfill automatically on load unless
 * `window.PagedMediaConfig.auto` is `false`.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import {
	polyfill,
	detectSupport,
	type PolyfillOptions,
	type PolyfillResult,
} from "./index.js";

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

interface PagedMediaConfig extends PolyfillOptions {
	/** Whether to run automatically on load. Defaults to true. */
	auto?: boolean;
}

interface PagedMediaGlobal {
	polyfill: typeof polyfill;
	detectSupport: typeof detectSupport;
	/** Resolves when the automatic run completes (undefined when auto is off). */
	ready?: Promise<PolyfillResult>;
	/** The result of the automatic run, once complete. */
	result?: PolyfillResult;
}

declare global {
	interface Window {
		PagedMedia?: PagedMediaGlobal;
		PagedMediaConfig?: PagedMediaConfig;
	}
}

//-----------------------------------------------------------------------------
// Bootstrap
//-----------------------------------------------------------------------------

const api: PagedMediaGlobal = { polyfill, detectSupport };
window.PagedMedia = api;

const config = window.PagedMediaConfig ?? {};

if (config.auto !== false) {
	const { auto, ...options } = config;
	void auto;

	api.ready = new Promise((resolve, reject) => {
		function run(): void {
			polyfill(options).then(result => {
				api.result = result;
				resolve(result);
			}, reject);
		}

		if (document.readyState === "complete") {
			run();
		} else {
			window.addEventListener("load", run, { once: true });
		}
	});
}

export { polyfill, detectSupport };
