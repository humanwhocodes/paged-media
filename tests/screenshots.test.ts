/**
 * @fileoverview Visual regression tests: every page of each fixture is
 * screenshotted and compared against the committed baseline images in
 * `tests/screenshots/baseline/<platform>/`. Current screenshots are always
 * written to `tests/screenshots/current/` for manual inspection; diffs of
 * failures go to `tests/screenshots/diff/`. Run with `UPDATE_SCREENSHOTS=1`
 * to refresh the baselines after an intentional rendering change.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { describe, it, expect, afterAll } from "vitest";
import {
	openFixture,
	runPolyfill,
	closeBrowser,
	browserName,
} from "./helpers/browser.js";
import {
	comparePageScreenshots,
	describeMismatches,
	shouldRun,
} from "./helpers/screenshots.js";

//-----------------------------------------------------------------------------
// Fixtures
//-----------------------------------------------------------------------------

/**
 * Fixtures to screenshot, with the polyfill options to use and the number
 * of pages expected (a sanity check so a layout regression cannot hide
 * behind freshly created baselines). `firefoxPages` overrides the page
 * count for Firefox, whose text metrics can shift a boundary-sensitive
 * page split.
 */
const FIXTURES: {
	name: string;
	pages: number;
	firefoxPages?: number;
	options?: Record<string, unknown>;
}[] = [
	{ name: "margin-boxes", pages: 3, options: { force: true } },
	{ name: "named-pages", pages: 5, options: { force: true } },
	{ name: "page-counters", pages: 4, options: { force: true } },
	{ name: "breaks", pages: 7 },
	{ name: "orphans-widows", pages: 2, options: { force: true } },
	{ name: "strings", pages: 5 },
	{ name: "running", pages: 3 },
	{ name: "footnotes", pages: 3, firefoxPages: 2 },
	{ name: "cross-refs", pages: 3 },
	{ name: "marks", pages: 1 },
	{ name: "tables-lists", pages: 4, options: { force: true } },
	{ name: "split-styles", pages: 4, options: { force: true } },
	{ name: "smoke", pages: 7 },
];

//-----------------------------------------------------------------------------
// Tests
//-----------------------------------------------------------------------------

afterAll(closeBrowser);

describe.skipIf(!shouldRun())("screenshots", () => {
	for (const fixture of FIXTURES) {
		it(`should render ${fixture.name} like the baseline`, async () => {
			const expectedPages =
				browserName === "firefox"
					? (fixture.firefoxPages ?? fixture.pages)
					: fixture.pages;
			const page = await openFixture(`${fixture.name}.html`);
			const result = await runPolyfill(page, fixture.options);

			expect(result.errors).toEqual([]);
			expect(result.pageCount).toBe(expectedPages);

			const comparisons = await comparePageScreenshots(
				page,
				fixture.name,
			);
			expect(comparisons).toHaveLength(expectedPages);
			expect(describeMismatches(comparisons)).toBe("");
			await page.close();
		});
	}
});
