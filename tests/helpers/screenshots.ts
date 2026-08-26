/**
 * @fileoverview Screenshot comparison helpers for visual regression tests.
 *
 * Every page of a paginated fixture is screenshotted and written to
 * `tests/screenshots/current/`. Each screenshot is compared against the
 * baseline in `tests/screenshots/baseline/`; on mismatch a diff image is
 * written to `tests/screenshots/diff/` and the test fails. Missing baselines
 * are created automatically (except on CI). Set `UPDATE_SCREENSHOTS=1` to
 * overwrite all baselines.
 *
 * Baselines are platform-specific because font rendering differs between
 * operating systems; on a platform without baselines the tests are skipped
 * on CI.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { platform } from "node:process";
import type { Page } from "puppeteer";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

export interface ScreenshotComparison {
	name: string;
	/** Path of the current screenshot. */
	current: string;
	/** Path of the baseline screenshot (may not exist yet). */
	baseline: string;
	/** Path of the diff image, when a mismatch was found. */
	diff?: string;
	/** Fraction of pixels that differ (0 when a baseline was created). */
	mismatch: number;
	/** Whether the baseline was (re)created by this run. */
	created: boolean;
}

//-----------------------------------------------------------------------------
// Constants
//-----------------------------------------------------------------------------

const ROOT = fileURLToPath(new URL("../screenshots/", import.meta.url));
const CURRENT_DIR = join(ROOT, "current");
const BASELINE_DIR = join(ROOT, "baseline");
const DIFF_DIR = join(ROOT, "diff");

/** Maximum fraction of differing pixels tolerated. */
const TOLERANCE = 0.001;

const UPDATE = process.env.UPDATE_SCREENSHOTS === "1";
const CI = !!process.env.CI;

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

/**
 * Determines whether baselines exist for the current platform.
 * @returns True if screenshot tests can run.
 */
export function hasBaselines(): boolean {
	return existsSync(join(BASELINE_DIR, platform));
}

/**
 * Determines whether screenshot tests should run: always locally, and on
 * CI only when baselines exist for this platform.
 * @returns True if the tests should run.
 */
export function shouldRun(): boolean {
	return !CI || hasBaselines();
}

async function readPng(path: string): Promise<PNG> {
	return PNG.sync.read(await readFile(path));
}

function compare(current: PNG, baseline: PNG): { mismatch: number; diff: PNG } {
	const width = Math.max(current.width, baseline.width);
	const height = Math.max(current.height, baseline.height);
	const a = pad(current, width, height);
	const b = pad(baseline, width, height);
	const diff = new PNG({ width, height });
	const differing = pixelmatch(a.data, b.data, diff.data, width, height, {
		threshold: 0.1,
		includeAA: true,
	});
	return { mismatch: differing / (width * height), diff };
}

function pad(image: PNG, width: number, height: number): PNG {
	if (image.width === width && image.height === height) {
		return image;
	}

	const padded = new PNG({ width, height, fill: true });
	padded.data.fill(255);
	PNG.bitblt(image, padded, 0, 0, image.width, image.height, 0, 0);
	return padded;
}

//-----------------------------------------------------------------------------
// Public API
//-----------------------------------------------------------------------------

/**
 * Screenshots every generated page and compares each against its baseline.
 * @param page The Puppeteer page (already paginated).
 * @param name The fixture name used for file names.
 * @returns The comparison for each page.
 */
export async function comparePageScreenshots(
	page: Page,
	name: string,
): Promise<ScreenshotComparison[]> {
	const currentDir = join(CURRENT_DIR, platform);
	const baselineDir = join(BASELINE_DIR, platform);
	const diffDir = join(DIFF_DIR, platform);
	await mkdir(currentDir, { recursive: true });
	await mkdir(baselineDir, { recursive: true });
	await mkdir(diffDir, { recursive: true });

	const handles = await page.$$(".pm-page");
	const results: ScreenshotComparison[] = [];

	for (let i = 0; i < handles.length; i++) {
		const fileName = `${name}-${i + 1}.png`;
		const current = join(currentDir, fileName);
		const baseline = join(baselineDir, fileName);
		const diff = join(diffDir, fileName);

		await handles[i].screenshot({ path: current });
		await rm(diff, { force: true });

		if (UPDATE || !existsSync(baseline)) {
			await writeFile(baseline, await readFile(current));
			results.push({
				name: fileName,
				current,
				baseline,
				mismatch: 0,
				created: true,
			});
			continue;
		}

		const comparison = compare(
			await readPng(current),
			await readPng(baseline),
		);

		if (comparison.mismatch > TOLERANCE) {
			await writeFile(diff, PNG.sync.write(comparison.diff));
			results.push({
				name: fileName,
				current,
				baseline,
				diff,
				mismatch: comparison.mismatch,
				created: false,
			});
		} else {
			results.push({
				name: fileName,
				current,
				baseline,
				mismatch: comparison.mismatch,
				created: false,
			});
		}
	}

	return results;
}

/**
 * Formats comparison failures for an assertion message.
 * @param results The comparisons.
 * @returns The failures as a readable string (empty when all match).
 */
export function describeMismatches(results: ScreenshotComparison[]): string {
	return results
		.filter(result => result.diff)
		.map(
			result =>
				`${result.name}: ${(result.mismatch * 100).toFixed(2)}% of pixels differ (diff: ${result.diff})`,
		)
		.join("\n");
}
