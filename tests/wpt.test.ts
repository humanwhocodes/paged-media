/**
 * @fileoverview Integration tests derived from Web Platform Tests for
 * css-gcpm and css-page (margin boxes). The originals are manual/reftests;
 * these assert the same expectations against the generated DOM.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { describe, it, expect, afterAll } from "vitest";
import { openFixture, runPolyfill, closeBrowser } from "./helpers/browser.js";

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

const LOREM =
	"Bacon ipsum dolor sit amet brisket sunt kielbasa, sed rump fatback shankle. Non exercitation aliquip culpa shankle. Sausage pork kevin, doner meatloaf venison cupidatat. Salami frankfurter spare ribs kielbasa culpa commodo incididunt.";

//-----------------------------------------------------------------------------
// Tests
//-----------------------------------------------------------------------------

afterAll(closeBrowser);

describe("css-gcpm (WPT)", () => {
	it("string-set-001: a named string can be set to a string value", async () => {
		const page = await openFixture(
			`<!DOCTYPE html><html><head><style>
				@page { size: 5in 5in; @top-center { content: string(title); } }
				h1 { string-set: title 'hello, world'; }
			</style></head><body>
				<h1>Chapter Title</h1>
				<p>Test passes if "hello, world" appears in the running head at the top of the page.</p>
			</body></html>`,
			true,
		);
		const result = await runPolyfill(page);
		expect(result.pages[0].boxes["top-center"]).toBe("hello, world");
		await page.close();
	});

	it("using-strings-001: the default assignment is first", async () => {
		const page = await openFixture(
			`<!DOCTYPE html><html><head><style>
				@page { size: 5in 5in; @top-center { content: string(section); } }
				h2 { string-set: section content(); }
			</style></head><body>
				<p>Test passes if "Section One" is in the running head at the top of the page.</p>
				<h2 id="s1">Section One</h2>
				<h2 id="s2">Section Two</h2>
				<h2 id="s3">Section Three</h2>
			</body></html>`,
			true,
		);
		const result = await runPolyfill(page);
		expect(result.pages).toHaveLength(1);
		expect(result.pages[0].boxes["top-center"]).toBe("Section One");
		await page.close();
	});

	it("using-strings-003: start uses the string set at the beginning of a page", async () => {
		const page = await openFixture(
			`<!DOCTYPE html><html><head><style>
				@page { size: 5in 7in; @top-center { content: string(section, start); } }
				h2 { string-set: section content(); }
				#s2 { page-break-before: always; }
				#s4 { page-break-after: always; }
			</style></head><body>
				<p>Note: this test has three pages</p>
				<h2 id="s1">Section One</h2><p>${LOREM}</p>
				<h2 id="s2">Section Two</h2><p>${LOREM}</p>
				<h2 id="s3">Section Three</h2><p>${LOREM}</p>
				<h2 id="s4">Section Four</h2><p>${LOREM}</p>
				<h2 id="s5">Section Five</h2><p>${LOREM}</p>
				<h2 id="s6">Section Six</h2><p>${LOREM}</p>
			</body></html>`,
			true,
		);
		const result = await runPolyfill(page);
		expect(result.pages).toHaveLength(3);
		expect(result.pages.map(p => p.boxes["top-center"])).toEqual([
			"",
			"Section Two",
			"Section Four",
		]);
		await page.close();
	});

	it("leader-001: a dotted leader fills the space before a following sibling", async () => {
		const page = await openFixture(
			`<!DOCTYPE html><html><head><style>
				@page { size: 5in 5in; margin: 0.5in; }
				@page :blank { }
				span.cn::after { content: leader(dotted); }
			</style></head><body>
				<ol>
					<li><span class="cn">Chapter One</span> <span class="folio">1</span></li>
				</ol>
			</body></html>`,
			true,
		);
		await runPolyfill(page);
		const info = await page.evaluate(() => {
			const cn = document.querySelector<HTMLElement>(".pm-page .cn")!;
			const folio =
				document.querySelector<HTMLElement>(".pm-page .folio")!;
			const li = cn.closest("li")!;
			const cnRect = cn.getBoundingClientRect();
			const folioRect = folio.getBoundingClientRect();
			const liRect = li.getBoundingClientRect();
			return {
				content: getComputedStyle(cn, "::after").content,
				sameLine: Math.abs(cnRect.top - folioRect.top) < 2,
				folioAtEnd: liRect.right - folioRect.right < 4,
				leaderWidth: parseFloat(
					cn.style.getPropertyValue("--pm-leader-width-0"),
				),
				gap: folioRect.left - cnRect.right,
			};
		});
		expect(info.content).toMatch(/^"\.{10,}"$/);
		expect(info.sameLine).toBe(true);
		expect(info.folioAtEnd).toBe(true);
		expect(info.leaderWidth).toBeGreaterThan(100);
		expect(info.gap).toBeLessThan(12);
		await page.close();
	});
});

describe("css-page margin boxes (WPT)", () => {
	it("content-001: various ways of expressing nothingness", async () => {
		const page = await openFixture(
			`<!DOCTYPE html><html><head><style>
				@page {
					size: 400px; margin: 100px;
					@top-left-corner { width: 50px; height: 50px; background: red; }
					@top-left { width: 100px; text-align: left; vertical-align: top; content: "PASS"; background: hotpink; }
					@top-right { text-align: left; vertical-align: top; content: "PA" "SS"; background: yellow; }
					@bottom-left { content: ""; background: yellow; }
					@bottom-left-corner { width: 50px; height: 50px; content: none; background: red; }
					@bottom-right-corner { width: 50px; height: 50px; content: normal; background: red; }
				}
			</style></head><body><p>x</p></body></html>`,
			true,
		);
		const result = await runPolyfill(page, { force: true });
		expect(result.pages[0].boxes).toEqual({
			"top-left": "PASS",
			"top-right": "PASS",
			"bottom-left": "",
		});

		const info = await page.evaluate(() => {
			const get = (name: string) =>
				document.querySelector<HTMLElement>(
					`.pm-margin-box.pm-${name}`,
				)!;
			return {
				topLeftWidth: get("top-left").getBoundingClientRect().width,
				topLeftBackground: getComputedStyle(get("top-left"))
					.backgroundColor,
				bottomLeftGenerated:
					!get("bottom-left").hasAttribute("data-pm-empty"),
				bottomLeftWidth:
					get("bottom-left").getBoundingClientRect().width,
				cornersEmpty: [
					"top-left-corner",
					"bottom-left-corner",
					"bottom-right-corner",
				].map(name => get(name).hasAttribute("data-pm-empty")),
			};
		});
		expect(info.topLeftWidth).toBe(100);
		expect(info.topLeftBackground).toBe("rgb(255, 105, 180)");
		expect(info.bottomLeftGenerated).toBe(true);
		expect(info.bottomLeftWidth).toBe(200);
		expect(info.cornersEmpty).toEqual([true, true, true]);
		await page.close();
	});

	it("dimensions-001: percentage and auto dimensions", async () => {
		const page = await openFixture(
			`<!DOCTYPE html><html><head><style>
				@page {
					margin: 100px; size: 500px 400px;
					@top-left { border: solid; text-align: left; vertical-align: top; width: 20%; height: 20%; content: "20%"; }
					@right-middle { text-align: left; vertical-align: top; border: solid; width: 70%; height: 70%; content: "70%"; }
					@bottom-right { text-align: left; vertical-align: top; border: solid; content: "auto"; }
					@left-bottom { text-align: left; vertical-align: top; border: solid; content: "auto"; }
				}
			</style></head><body><p>x</p></body></html>`,
			true,
		);
		const result = await runPolyfill(page, { force: true });
		expect(result.pages[0].boxes).toEqual({
			"top-left": "20%",
			"right-middle": "70%",
			"bottom-right": "auto",
			"left-bottom": "auto",
		});

		const rects = await page.evaluate(() => {
			const pageRect = document
				.querySelector(".pm-page")!
				.getBoundingClientRect();
			const get = (name: string) => {
				const rect = document
					.querySelector<HTMLElement>(`.pm-margin-box.pm-${name}`)!
					.getBoundingClientRect();
				return {
					left: Math.round(rect.left - pageRect.left),
					top: Math.round(rect.top - pageRect.top),
					width: Math.round(rect.width),
					height: Math.round(rect.height),
				};
			};
			return {
				topLeft: get("top-left"),
				rightMiddle: get("right-middle"),
				bottomRight: get("bottom-right"),
				leftBottom: get("left-bottom"),
			};
		});
		// available width 300, top margin 100: 20% → 60 x 20
		expect(rects.topLeft).toEqual({
			left: 100,
			top: 0,
			width: 60,
			height: 20,
		});
		// available height 200, right margin 100: 70% → 70 x 140
		expect(rects.rightMiddle.width).toBe(70);
		expect(rects.rightMiddle.height).toBe(140);
		expect(rects.rightMiddle.left).toBe(400);
		// lone auto boxes take the whole available size
		expect(rects.bottomRight).toEqual({
			left: 100,
			top: 300,
			width: 300,
			height: 100,
		});
		expect(rects.leftBottom).toEqual({
			left: 0,
			top: 100,
			width: 100,
			height: 200,
		});
		await page.close();
	});
});
