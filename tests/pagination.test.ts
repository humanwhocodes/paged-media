/**
 * @fileoverview Integration tests for pagination: forced breaks, blank
 * pages, avoid constraints, orphans/widows, tables, lists, and split styles.
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

describe("pagination", () => {
	it("should honor forced breaks, left/right breaks, and break-inside: avoid", async () => {
		const page = await openFixture("breaks.html");
		const result = await runPolyfill(page);

		expect(result.errors).toEqual([]);
		expect(result.polyfilled).toBe(true);
		expect(result.polyfilledFeatures).toContain("leftRightBreaks");
		expect(result.pages.map(p => p.body)).toEqual([
			"A",
			"B",
			"C",
			"D E",
			"F 1234",
			"K1K2 G 56",
			"7 H I",
		]);
		expect(result.pages.map(p => p.classes.includes("pm-right"))).toEqual([
			true,
			false,
			true,
			false,
			true,
			false,
			true,
		]);
		expect(result.pages.every(p => p.overflow <= 0)).toBe(true);
		expect(result.pages.some(p => p.blank)).toBe(false);

		const pdf = await printToPdf(page);
		expect(pdf).toHaveLength(7);
		expect(pdf[0].width).toBe(288);
		expect(pdf[0].height).toBe(288);
		await page.close();
	});

	it("should insert blank pages for left/right breaks", async () => {
		const page = await openFixture(
			`<!doctype html><html><head><style>
				@page { size: 4in 4in; margin: 0.5in; @top-center { content: "P" counter(page); } }
				@page :blank { @top-center { content: "BLANK"; } }
				p { margin: 0; }
			</style></head><body>
				<p>One</p>
				<p style="break-before: right">Three</p>
				<p style="break-before: verso">Four</p>
				<p style="break-before: page; break-after: recto">Five</p>
				<p>Seven</p>
			</body></html>`,
			true,
		);
		const result = await runPolyfill(page);

		expect(result.errors).toEqual([]);
		expect(
			result.pages.map(p => [p.body, p.blank, p.boxes["top-center"]]),
		).toEqual([
			["One", false, "P1"],
			["", true, "BLANK"],
			["Three", false, "P3"],
			["Four", false, "P4"],
			["Five", false, "P5"],
			["", true, "BLANK"],
			["Seven", false, "P7"],
		]);
		await page.close();
	});

	it("should not generate a blank page when the first content forces a right page", async () => {
		const page = await openFixture(
			`<!doctype html><html><head><style>
				@page { size: 4in 4in; margin: 0.5in; }
				@page :blank { }
				h1 { break-before: right; }
			</style></head><body><h1>Start</h1><p>Text</p></body></html>`,
			true,
		);
		const result = await runPolyfill(page);
		expect(result.pages).toHaveLength(1);
		expect(result.pages[0].blank).toBe(false);
		await page.close();
	});

	it("should honor orphans and widows", async () => {
		const page = await openFixture("orphans-widows.html");
		const result = await runPolyfill(page, { force: true });

		expect(result.errors).toEqual([]);
		// Page area is 288px; the filler takes 240px leaving room for two of
		// the six 20px lines. With orphans: 3 the paragraph must move entirely.
		expect(result.pages).toHaveLength(2);
		expect(result.pages[0].body).toBe("filler");
		expect(result.pages[1].body).toContain("Line one text");
		await page.close();
	});

	it("should move the break to satisfy widows", async () => {
		const page = await openFixture(
			`<!doctype html><html><head><style>
				@page { size: 4in 4in; margin: 0.5in; }
				body { margin: 0; font: 14px/20px monospace; }
				p { margin: 0; }
				.tall { height: 180px; }
				#lines { orphans: 2; widows: 3; }
			</style></head><body>
				<div class="tall">filler</div>
				<p id="lines">L1<br>L2<br>L3<br>L4<br>L5<br>L6</p>
			</body></html>`,
			true,
		);
		const result = await runPolyfill(page, { force: true });

		// 288 - 180 = 108px → 5 lines fit, leaving 1 widow. Moving 2 lines
		// down gives 3 lines on each page.
		expect(result.pages).toHaveLength(2);
		expect(result.pages[0].body).toBe("filler L1L2L3");
		expect(result.pages[1].body).toBe("L4L5L6");
		await page.close();
	});

	it("should split tables between rows and repeat the header", async () => {
		const page = await openFixture("tables-lists.html");
		const result = await runPolyfill(page, { force: true });

		expect(result.errors).toEqual([]);
		expect(result.pages[0].body).toBe("Head R1R2R3R4 R5R6");
		expect(result.pages[1].body).toBe("HeadR7R8");
		expect(result.pages.every(p => p.overflow <= 0)).toBe(true);
		await page.close();
	});

	it("should continue ordered list numbering across pages", async () => {
		const page = await openFixture("tables-lists.html");
		await runPolyfill(page, { force: true });

		const starts = await page.evaluate(() =>
			[...document.querySelectorAll(".pm-page ol")].map(ol => ({
				start: (ol as HTMLOListElement).start,
				items: [...ol.querySelectorAll("li")].map(li => li.textContent),
			})),
		);
		expect(starts).toEqual([
			{
				start: 3,
				items: [
					"Item 3",
					"Item 4",
					"Item 5",
					"Item 6",
					"Item 7",
					"Item 8",
					"Item 9",
				],
			},
			{ start: 10, items: ["Item 10"] },
		]);
		await page.close();
	});

	it("should slice or clone box decorations of split elements", async () => {
		const page = await openFixture("split-styles.html");
		const result = await runPolyfill(page, { force: true });

		expect(result.errors).toEqual([]);
		// Each 200px paragraph needs its own page once the box decorations
		// are added, and the clone box cannot start on the slice box's page.
		expect(result.pages).toHaveLength(4);

		const boxes = await page.evaluate(() =>
			[...document.querySelectorAll<HTMLElement>(".pm-page .box")].map(
				box => {
					const style = getComputedStyle(box);
					return {
						id: box.id,
						top: style.borderTopWidth,
						bottom: style.borderBottomWidth,
						continued: box.hasAttribute("data-pm-continued"),
						split: box.hasAttribute("data-pm-split-after"),
					};
				},
			),
		);
		expect(boxes).toEqual([
			{
				id: "slice",
				top: "10px",
				bottom: "0px",
				continued: false,
				split: true,
			},
			{
				id: "",
				top: "0px",
				bottom: "10px",
				continued: true,
				split: false,
			},
			{
				id: "clone",
				top: "10px",
				bottom: "10px",
				continued: false,
				split: false,
			},
			{
				id: "",
				top: "10px",
				bottom: "10px",
				continued: true,
				split: false,
			},
		]);
		expect(result.pages.map(p => p.body)).toEqual([
			"One",
			"Two",
			"Three",
			"Four",
		]);
		await page.close();
	});

	it("should split long text at line boundaries without losing characters", async () => {
		const words = Array.from({ length: 400 }, (_, i) => `w${i}`).join(" ");
		const page = await openFixture(
			`<!doctype html><html><head><style>
				@page { size: 4in 4in; margin: 0.5in; }
				body { margin: 0; font: 14px/20px monospace; }
				p { margin: 0; }
			</style></head><body><p id="long">${words}</p></body></html>`,
			true,
		);
		const result = await runPolyfill(page, { force: true });

		expect(result.pages.length).toBeGreaterThan(1);
		expect(result.pages.every(p => p.overflow <= 0)).toBe(true);
		const joined = result.pages
			.map(p => p.body)
			.join(" ")
			.replace(/\s+/g, " ");
		expect(joined.split(" ")).toEqual(words.split(" "));
		await page.close();
	});

	it("should keep an element taller than the page and continue after it", async () => {
		const page = await openFixture(
			`<!doctype html><html><head><style>
				@page { size: 4in 4in; margin: 0.5in; }
				body { margin: 0; }
				.huge { height: 500px; break-inside: avoid; }
			</style></head><body><div class="huge">Huge</div><p>After</p></body></html>`,
			true,
		);
		const result = await runPolyfill(page, { force: true });

		expect(result.errors).toEqual([]);
		expect(result.pages.map(p => p.body)).toEqual(["Huge", "After"]);
		await page.close();
	});

	it("should treat images as unbreakable", async () => {
		const page = await openFixture(
			`<!doctype html><html><head><style>
				@page { size: 4in 4in; margin: 0.5in; }
				body { margin: 0; font: 14px/20px monospace; }
				p { margin: 0; }
				.tall { height: 200px; }
				img { display: block; width: 100px; height: 100px; }
			</style></head><body>
				<p class="tall">filler</p>
				<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="">
				<p>After</p>
			</body></html>`,
			true,
		);
		const result = await runPolyfill(page, { force: true });

		expect(result.pages).toHaveLength(2);
		expect(result.pages[0].body).toBe("filler");
		expect(result.pages[1].body).toBe("After");
		const imgPage = await page.evaluate(() =>
			document
				.querySelector(".pm-page img")!
				.closest(".pm-page")!
				.getAttribute("data-pm-page-index"),
		);
		expect(imgPage).toBe("2");
		await page.close();
	});

	it("should produce a single empty page for an empty document", async () => {
		const page = await openFixture("blank.html");
		const result = await runPolyfill(page, { force: true });
		expect(result.pages).toHaveLength(1);
		expect(result.pages[0].body).toBe("");
		await page.close();
	});
});
