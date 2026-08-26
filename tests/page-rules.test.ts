/**
 * @fileoverview Integration tests for @page rules: margin boxes, page
 * selectors, named pages, page counters, page sizes, marks, and bleed.
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
	printToPdf,
} from "./helpers/browser.js";

//-----------------------------------------------------------------------------
// Tests
//-----------------------------------------------------------------------------

afterAll(closeBrowser);

describe("margin boxes", () => {
	it("should render all sixteen margin boxes with the page cascade", async () => {
		const page = await openFixture("margin-boxes.html");
		const result = await runPolyfill(page, { force: true });

		expect(result.errors).toEqual([]);
		expect(result.pages).toHaveLength(3);

		const [first, second, third] = result.pages;
		expect(first.boxes).toEqual({
			"top-left-corner": "TLC",
			"top-center": "FIRST",
			"top-right": "RIGHTPAGE",
			"top-right-corner": "TRC",
			"left-top": "LT",
			"left-middle": "LM",
			"left-bottom": "LB",
			"right-top": "RT",
			"right-middle": "RM",
			"right-bottom": "RB",
			"bottom-left-corner": "BLC",
			"bottom-left": "BL",
			"bottom-center": "Page 1 of 3",
			"bottom-right": "BR",
			"bottom-right-corner": "BRC",
		});
		expect(second.boxes["top-left"]).toBe("TL");
		expect(second.boxes["top-center"]).toBe("TC");
		expect(second.boxes["top-right"]).toBe("LEFTPAGE");
		expect(second.boxes["bottom-center"]).toBe("Page 2 of 3");
		expect(third.boxes["top-right"]).toBe("RIGHTPAGE");
		expect(third.boxes["bottom-left"]).toBe("THIRD");
		await page.close();
	});

	it("should position margin boxes within the page margins", async () => {
		const page = await openFixture("margin-boxes.html");
		await runPolyfill(page, { force: true });

		const rects = await page.evaluate(() => {
			const first = document.querySelector(".pm-page")!;
			const pageRect = first.getBoundingClientRect();
			const out: Record<
				string,
				{ left: number; top: number; width: number; height: number }
			> = {};

			for (const box of first.querySelectorAll<HTMLElement>(
				".pm-margin-box",
			)) {
				if (box.hasAttribute("data-pm-empty")) {
					continue;
				}

				const rect = box.getBoundingClientRect();
				out[box.className.replace("pm-margin-box pm-", "")] = {
					left: Math.round(rect.left - pageRect.left),
					top: Math.round(rect.top - pageRect.top),
					width: Math.round(rect.width),
					height: Math.round(rect.height),
				};
			}

			return out;
		});

		// margins: top 96, right 72, bottom 120, left 48; page 576x768
		expect(rects["top-left-corner"]).toEqual({
			left: 0,
			top: 0,
			width: 48,
			height: 96,
		});
		expect(rects["top-right-corner"]).toEqual({
			left: 504,
			top: 0,
			width: 72,
			height: 96,
		});
		expect(rects["bottom-left-corner"]).toEqual({
			left: 0,
			top: 648,
			width: 48,
			height: 120,
		});
		expect(rects["bottom-right-corner"]).toEqual({
			left: 504,
			top: 648,
			width: 72,
			height: 120,
		});
		expect(rects["left-top"].left).toBe(0);
		expect(rects["left-top"].width).toBe(48);
		expect(rects["left-top"].top).toBe(96);
		expect(rects["right-bottom"].left).toBe(504);
		expect(
			rects["left-top"].height +
				rects["left-middle"].height +
				rects["left-bottom"].height,
		).toBe(768 - 96 - 120);

		// The center box is centered in the top margin area.
		const center = rects["top-center"];
		expect(center.left + center.width / 2).toBeCloseTo(
			48 + (576 - 48 - 72) / 2,
			0,
		);
		expect(center.top).toBe(0);
		expect(center.height).toBe(96);
		await page.close();
	});

	it("should size side boxes per the spec when the center box is empty", async () => {
		const page = await openFixture(
			`<!doctype html><html><head><style>
				@page {
					size: 400px 400px; margin: 50px;
					@top-left { content: "Left"; font: 10px monospace; }
					@top-right { content: "Right text"; font: 10px monospace; }
					@bottom-left { content: "Solo"; }
				}
			</style></head><body><p>x</p></body></html>`,
			true,
		);
		await runPolyfill(page, { force: true });

		const widths = await page.evaluate(() => {
			const get = (name: string) =>
				document
					.querySelector<HTMLElement>(`.pm-margin-box.pm-${name}`)!
					.getBoundingClientRect().width;
			return {
				topLeft: get("top-left"),
				topRight: get("top-right"),
				bottomLeft: get("bottom-left"),
			};
		});

		// Extra space is distributed proportionally to max-content widths, so
		// the wider box gets more than half of the 300px.
		expect(widths.topLeft + widths.topRight).toBeCloseTo(300, 0);
		expect(widths.topRight).toBeGreaterThan(widths.topLeft);
		expect(widths.bottomLeft).toBeCloseTo(300, 0);
		await page.close();
	});

	it("should apply margin box styles and vertical alignment", async () => {
		const page = await openFixture(
			`<!doctype html><html><head><style>
				@page {
					size: 400px 400px; margin: 100px;
					@top-center { content: "X"; vertical-align: bottom; color: rgb(255, 0, 0); border-bottom: 2px solid; }
					@top-left { content: "Y"; vertical-align: top; }
					@bottom-center { content: "Z"; }
				}
			</style></head><body><p>x</p></body></html>`,
			true,
		);
		await runPolyfill(page, { force: true });

		const info = await page.evaluate(() => {
			const get = (name: string) =>
				document.querySelector<HTMLElement>(
					`.pm-margin-box.pm-${name}`,
				)!;
			const center = get("top-center");
			const style = getComputedStyle(center);
			return {
				color: style.color,
				border: style.borderBottomWidth,
				centerAlign: style.alignItems,
				leftAlign: getComputedStyle(get("top-left")).alignItems,
				bottomAlign: getComputedStyle(get("bottom-center")).alignItems,
			};
		});
		expect(info).toEqual({
			color: "rgb(255, 0, 0)",
			border: "2px",
			centerAlign: "flex-end",
			leftAlign: "flex-start",
			bottomAlign: "center",
		});
		await page.close();
	});
});

describe("named pages and selectors", () => {
	it("should apply named pages, page groups, :first, and :nth", async () => {
		const page = await openFixture("named-pages.html");
		const result = await runPolyfill(page, { force: true });

		expect(result.errors).toEqual([]);
		expect(
			result.pages.map(p => [
				p.name,
				p.boxes["top-center"],
				p.boxes["bottom-center"],
			]),
		).toEqual([
			[null, "default", "doc-first"],
			["wide", "wide", undefined],
			["chapter", "chapter-first", undefined],
			["chapter", "chapter-second", undefined],
			[null, "default", undefined],
		]);
		expect(result.pages[0]).toMatchObject({ width: 384, height: 576 });
		expect(result.pages[1]).toMatchObject({ width: 576, height: 384 });

		const pdf = await printToPdf(page);
		expect(pdf.map(p => [p.width, p.height])).toEqual([
			[288, 432],
			[432, 288],
			[288, 432],
			[288, 432],
			[288, 432],
		]);
		expect(pdf[1].text).toContain("Wide one");
		expect(pdf[2].text).toContain("chapter-first");
		await page.close();
	});

	it("should support page counters with resets, increments, and styles", async () => {
		const page = await openFixture("page-counters.html");
		const result = await runPolyfill(page, { force: true });

		expect(result.errors).toEqual([]);
		expect(
			result.pages.map(p => [
				p.boxes["bottom-center"],
				p.boxes["bottom-right"],
			]),
		).toEqual([
			["i", "4"],
			["ii", "4"],
			["1", "4"],
			["2", "4"],
		]);
		await page.close();
	});

	it("should support counter-increment in the page context", async () => {
		const page = await openFixture(
			`<!doctype html><html><head><style>
				@page { size: 4in 4in; counter-increment: page 2; @top-center { content: counter(page); } }
				@page :first { counter-reset: page 4; }
				p { break-before: page; }
			</style></head><body><p>a</p><p>b</p><p>c</p></body></html>`,
			true,
		);
		const result = await runPolyfill(page, { force: true });
		expect(result.pages.map(p => p.boxes["top-center"])).toEqual([
			"6",
			"8",
			"10",
		]);
		await page.close();
	});

	it("should pass through documents using only native features", async () => {
		const page = await openFixture("native.html");
		const result = await runPolyfill(page);

		expect(result.polyfilled).toBe(false);
		expect(result.pageCount).toBe(0);
		expect(result.pages).toEqual([]);
		expect(result.features.sort()).toEqual(
			["marginBoxes", "pageCounters", "pageSelectors", "pageSize"].sort(),
		);
		expect(result.polyfilledFeatures).toEqual([]);

		const untouched = await page.evaluate(
			() => !document.querySelector(".pm-pages"),
		);
		expect(untouched).toBe(true);
		await page.close();
	});

	it("should use the default page size and margin options", async () => {
		const page = await openFixture(
			`<!doctype html><html><head><style>@page :blank { }</style></head><body><p>x</p></body></html>`,
			true,
		);
		const result = await runPolyfill(page, {
			defaultPageSize: "A4 landscape",
			defaultMargin: "1in",
		});

		expect(result.polyfilled).toBe(true);
		expect(result.pages[0].width).toBeCloseTo((297 * 96) / 25.4, 0);
		expect(result.pages[0].height).toBeCloseTo((210 * 96) / 25.4, 0);

		const area = await page.evaluate(() => {
			const rect = document
				.querySelector(".pm-area")!
				.getBoundingClientRect();
			const pageRect = document
				.querySelector(".pm-page")!
				.getBoundingClientRect();
			return {
				left: rect.left - pageRect.left,
				top: rect.top - pageRect.top,
			};
		});
		expect(area).toEqual({ left: 96, top: 96 });
		await page.close();
	});
});

describe("marks and bleed", () => {
	it("should enlarge the sheet for bleed and marks", async () => {
		const page = await openFixture("marks.html");
		const result = await runPolyfill(page);

		expect(result.errors).toEqual([]);
		expect(result.polyfilledFeatures.sort()).toEqual(["bleed", "marks"]);

		// 4in page + 2 * (0.25in bleed + 10mm marks area)
		const outset = 24 + (96 / 25.4) * 10;
		expect(result.pages[0].width).toBeCloseTo(384 + 2 * outset, 0);

		const info = await page.evaluate(() => {
			const svg = document.querySelector(".pm-marks")!;
			const pageBox = document.querySelector<HTMLElement>(".pm-pagebox")!;
			const trim = document.querySelector<HTMLElement>(".pm-trim")!;
			return {
				lines: svg.querySelectorAll("line").length,
				circles: svg.querySelectorAll("circle").length,
				pageBoxWidth: pageBox.getBoundingClientRect().width,
				trimWidth: trim.getBoundingClientRect().width,
				background: getComputedStyle(pageBox).backgroundColor,
			};
		});
		expect(info.lines).toBe(8 + 8);
		expect(info.circles).toBe(4);
		expect(info.pageBoxWidth).toBe(384 + 48);
		expect(info.trimWidth).toBe(384);
		expect(info.background).toBe("rgb(238, 238, 238)");

		const pdf = await printToPdf(page);
		expect(pdf[0].width).toBeCloseTo((384 + 2 * outset) * 0.75, 0);
		await page.close();
	});
});
