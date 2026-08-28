/**
 * @fileoverview Integration tests for generated content: named strings,
 * running elements, footnotes, cross references, and leaders.
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
	getBrowser,
	getServer,
	fixtureURL,
	browserName,
} from "./helpers/browser.js";

//-----------------------------------------------------------------------------
// Tests
//-----------------------------------------------------------------------------

afterAll(closeBrowser);

describe("named strings", () => {
	it("should resolve string() with first, start, last, and first-except", async () => {
		const page = await openFixture("strings.html");
		const result = await runPolyfill(page);

		expect(result.errors).toEqual([]);
		expect(result.polyfilledFeatures).toContain("namedStrings");
		expect(result.pages.map(p => p.boxes)).toEqual([
			{
				"top-left": "Alpha",
				"top-center": "",
				"top-right": "Beta",
				"bottom-left": "",
				"bottom-center": "Ada",
				"bottom-right": "Sec 1: One",
			},
			{
				"top-left": "Gamma",
				"top-center": "Gamma",
				"top-right": "Gamma",
				"bottom-left": "",
				"bottom-center": "Cy",
				"bottom-right": "Sec 1: One",
			},
			{
				"top-left": "Gamma",
				"top-center": "Gamma",
				"top-right": "Gamma",
				"bottom-left": "Gamma",
				"bottom-center": "Cy",
				"bottom-right": "Sec 1: One",
			},
			{
				"top-left": "Gamma",
				"top-center": "Gamma",
				"top-right": "Gamma",
				"bottom-left": "Gamma",
				"bottom-center": "Cy",
				"bottom-right": "Sec 1: One",
			},
			{
				"top-left": "Gamma",
				"top-center": "Gamma",
				"top-right": "Gamma",
				"bottom-left": "Gamma",
				"bottom-center": "Cy",
				"bottom-right": "Sec 2: Two",
			},
		]);
		await page.close();
	});

	it("should support content(before), content(after), and content(first-letter)", async () => {
		const page = await openFixture(
			`<!doctype html><html><head><style>
				@page { size: 4in 4in; margin: 0.5in;
					@top-left { content: string(b); } @top-center { content: string(a); } @top-right { content: string(f); } }
				h1 { string-set: b content(before), a content(after), f content(first-letter); }
				h1::before { content: "Pre"; }
				h1::after { content: "Post"; }
			</style></head><body><h1>“quoted” heading</h1></body></html>`,
			true,
		);
		const result = await runPolyfill(page);
		expect(result.pages[0].boxes).toEqual({
			"top-left": "Pre",
			"top-center": "Post",
			"top-right": "“q",
		});
		await page.close();
	});
});

describe("running elements", () => {
	it("should remove running elements from the flow and place them in margin boxes", async () => {
		const page = await openFixture("running.html");
		const result = await runPolyfill(page);

		expect(result.errors).toEqual([]);
		expect(result.polyfilledFeatures).toContain("runningElements");
		expect(
			result.pages.map(p => [
				p.body,
				p.boxes["top-center"],
				p.boxes["bottom-center"],
			]),
		).toEqual([
			["Page one", "Header One", "Footer A"],
			["Page two", "Header Two", "Footer C"],
			["Page three", "Header Two", "Footer C"],
		]);

		const header = await page.evaluate(() => {
			const box = document.querySelector(
				".pm-page .pm-margin-box.pm-top-center",
			)!;
			const hdr = box.querySelector(".hdr")!;
			return {
				tag: hdr.tagName,
				running: hdr.getAttribute("data-pm-running"),
				weight: getComputedStyle(hdr).fontWeight,
				em: hdr.querySelector("em")?.textContent,
			};
		});
		expect(header).toEqual({
			tag: "DIV",
			running: "header",
			weight: "700",
			em: "One",
		});
		await page.close();
	});
});

describe("footnotes", () => {
	it("should move footnotes to the footnote area with calls and markers", async () => {
		const page = await openFixture("footnotes.html");
		const result = await runPolyfill(page);

		expect(result.errors).toEqual([]);
		expect(result.polyfilledFeatures).toContain("footnotes");
		if (browserName === "firefox") {
			// Firefox's slightly different text metrics let the Zeta line
			// and its notes fit on the first page (it fills the page area
			// exactly); both distributions are valid layouts.
			expect(result.pages).toHaveLength(2);
			expect(result.pages[0].body).toBe(
				"Alpha[1] beta[2] gamma. filler Delta[3] epsilon[4]. Zeta[5] eta[6] theta.",
			);
			expect(result.pages[0].footnotes).toBe(
				"1Note A2Note B3Note C4Note D5Note E6Note F",
			);
			expect(result.pages[0].overflow).toBeLessThanOrEqual(0);
			expect(result.pages[1].body).toBe("Next page[1].");
			expect(result.pages[1].footnotes).toBe("1Note G");
		} else {
			expect(result.pages).toHaveLength(3);
			expect(result.pages[0].body).toBe(
				"Alpha[1] beta[2] gamma. filler Delta[3] epsilon[4].",
			);
			expect(result.pages[0].footnotes).toBe(
				"1Note A2Note B3Note C4Note D",
			);
			expect(result.pages[0].overflow).toBeLessThanOrEqual(0);
			// The line whose notes no longer fit moves to the next page, and
			// the footnote counter resets per page.
			expect(result.pages[1].body).toBe("Zeta[1] eta[2] theta.");
			expect(result.pages[1].footnotes).toBe("1Note E2Note F");
			expect(result.pages[2].body).toBe("Next page[1].");
			expect(result.pages[2].footnotes).toBe("1Note G");
		}

		const info = await page.evaluate(() => {
			const first = document.querySelector(".pm-page")!;
			const area = first.querySelector<HTMLElement>(".pm-footnotes")!;
			const notes = [...area.children] as HTMLElement[];
			const call = first.querySelector<HTMLElement>(".pm-footnote-call")!;
			const marker = first.querySelector<HTMLElement>(
				".pm-footnote-marker",
			)!;
			return {
				borderTop: getComputedStyle(area).borderTopWidth,
				displays: notes.map(note => getComputedStyle(note).display),
				callColor: getComputedStyle(call).color,
				callAlign: getComputedStyle(call).verticalAlign,
				markerWeight: getComputedStyle(marker).fontWeight,
				markerAfter: getComputedStyle(marker, "::after").content,
				callInFlow: !!call.closest(".pm-body"),
				areaAtBottom:
					Math.round(area.getBoundingClientRect().bottom) ===
					Math.round(
						first.querySelector(".pm-area")!.getBoundingClientRect()
							.bottom,
					),
			};
		});
		expect(info.borderTop).toBe("1px");
		expect(info.displays).toEqual(
			browserName === "firefox"
				? ["block", "block", "inline", "inline", "block", "block"]
				: ["block", "block", "inline", "inline"],
		);
		expect(info.callColor).toBe("rgb(255, 0, 0)");
		expect(info.callAlign).toBe("super");
		expect(info.markerWeight).toBe("700");
		expect(info.markerAfter).toBe('". "');
		expect(info.callInFlow).toBe(true);
		expect(info.areaAtBottom).toBe(true);
		await page.close();
	});

	it("should move a footnote with its call to the next page when it does not fit", async () => {
		const page = await openFixture(
			`<!doctype html><html><head><style>
				@page { size: 4in 4in; margin: 0.5in; }
				body { margin: 0; font: 14px/20px "Test Mono"; }
				p { margin: 0; }
				.fn { float: footnote; }
				.tall { height: 240px; }
			</style></head><body>
				<div class="tall">filler</div>
				<p>Line one</p>
				<p>Line two<span class="fn">A long footnote that takes several lines of text to render in the footnote area of the page.</span> end</p>
			</body></html>`,
			true,
		);
		const result = await runPolyfill(page);

		expect(result.errors).toEqual([]);
		expect(result.pages).toHaveLength(2);
		expect(result.pages[0].body).toBe("filler Line one");
		expect(result.pages[0].footnotes).toBe("");
		expect(result.pages[1].body).toBe("Line two1 end");
		expect(result.pages[1].footnotes).toMatch(/^1A long footnote/);
		await page.close();
	});

	it("should number footnotes continuously without a per-page reset", async () => {
		const page = await openFixture(
			`<!doctype html><html><head><style>
				@page { size: 4in 4in; margin: 0.5in; }
				.fn { float: footnote; }
				.page { break-before: page; }
			</style></head><body>
				<p>A<span class="fn">one</span></p>
				<p class="page">B<span class="fn">two</span></p>
			</body></html>`,
			true,
		);
		const result = await runPolyfill(page);
		expect(result.pages.map(p => p.footnotes)).toEqual(["1one", "2two"]);
		await page.close();
	});
});

describe("cross references and leaders", () => {
	it("should resolve target-counter, target-text, target-counters, and page counters", async () => {
		const page = await openFixture("cross-refs.html");
		const result = await runPolyfill(page);

		expect(result.errors).toEqual([]);
		expect(result.polyfilledFeatures).toEqual(
			expect.arrayContaining(["crossReferences", "leaders"]),
		);
		expect(result.pages.map(p => p.number)).toEqual(["11", "12", "13"]);

		const after = await page.evaluate(() => {
			const get = (id: string) =>
				getComputedStyle(
					document.querySelector(`.pm-page #${id}`)!,
					"::after",
				).content;
			return {
				l1: get("l1"),
				l2: get("l2"),
				ref1: get("ref1"),
				ref2: get("ref2"),
				ref3: get("ref3"),
				ref4: get("ref4"),
				here: get("here"),
			};
		});
		expect(after.l1).toMatch(/^"\.+12"$/);
		expect(after.l2).toMatch(/^"\.+13"$/);
		expect(after.ref1).toBe('" -> xiii"');
		expect(after.ref2).toBe('" -> Two"');
		expect(after.ref3).toBe('" -> 1 / 2"');
		expect(after.ref4).toBe('" -> "');
		expect(after.here).toBe('" [p11/3]"');
		await page.close();
	});

	it("should size leaders to fill the line with the trailing text on the same line", async () => {
		const page = await openFixture("cross-refs.html");
		await runPolyfill(page);

		const info = await page.evaluate(() => {
			const link = document.querySelector<HTMLElement>(".pm-page #l1")!;
			const containerWidth =
				link.parentElement!.getBoundingClientRect().width;
			const width = parseFloat(
				link.style.getPropertyValue("--pm-leader-width-0"),
			);
			return {
				containerWidth,
				width,
			};
		});
		expect(info.width).toBeGreaterThan(100);
		expect(info.width).toBeLessThanOrEqual(info.containerWidth);
		// Ensure the leader occupies a meaningful portion of the container width.
		expect(info.width / info.containerWidth).toBeGreaterThan(0.3);
		await page.close();

		const printed = await openFixture("cross-refs.html");
		await runPolyfill(printed);
		const pdf = await printToPdf(printed);
		expect(pdf[0].text).toMatch(/Chapter One\s*\.+\s*12/);
		expect(pdf[0].text).toContain("-> xiii");
		await printed.close();
	});

	it("should evaluate counter(page) in flow content", async () => {
		const page = await openFixture(
			`<!doctype html><html><head><style>
				@page { size: 4in 4in; margin: 0.5in; }
				p::after { content: " on page " counter(page) " of " counter(pages); }
				.page { break-before: page; }
			</style></head><body><p>A</p><p class="page">B</p></body></html>`,
			true,
		);
		await runPolyfill(page);
		const contents = await page.evaluate(() =>
			[...document.querySelectorAll(".pm-page p")].map(
				p => getComputedStyle(p, "::after").content,
			),
		);
		expect(contents).toEqual(['" on page 1 of 2"', '" on page 2 of 2"']);
		await page.close();
	});
});

describe("stylesheet handling", () => {
	it("should load external and imported stylesheets and honor media attributes", async () => {
		const page = await openFixture("external.html");
		const result = await runPolyfill(page);

		expect(result.errors).toEqual([]);
		expect(result.polyfilled).toBe(true);
		expect(result.pages[0].boxes["top-center"]).toBe("external");
		expect(result.pages[0].boxes["bottom-center"]).toBe("imported");
		expect(result.pages[0].boxes["top-left"]).toBe("print-media");
		expect(result.pages[0].boxes["top-right"]).toBeUndefined();

		const color = await page.evaluate(
			() => getComputedStyle(document.querySelector(".pm-page p")!).color,
		);
		expect(color).toBe("rgb(0, 128, 0)");
		await page.close();
	});

	it("should return the existing result when applied twice", async () => {
		const page = await openFixture("auto.html");
		const info = await page.evaluate(async () => {
			const first = await window.PagedMedia!.polyfill();
			const second = await window.PagedMedia!.polyfill();
			return {
				same: first === second,
				pageCount: second.pageCount,
				pages: document.querySelectorAll(".pm-page").length,
				sources: document.querySelectorAll(".pm-source").length,
			};
		});
		expect(info).toEqual({
			same: true,
			pageCount: 2,
			pages: 2,
			sources: 1,
		});
		await page.close();
	});

	it("should expose the API on window and run automatically", async () => {
		await getServer();
		const page = await (await getBrowser()).newPage();
		await page.goto(fixtureURL("auto.html"), { waitUntil: "load" });
		const result = await page.evaluate(async () => {
			const outcome = await window.PagedMedia!.ready!;
			return {
				polyfilled: outcome.polyfilled,
				pageCount: outcome.pageCount,
				rendered: (window as unknown as { rendered: number }).rendered,
				pages: document.querySelectorAll(".pm-page").length,
				support: typeof window.PagedMedia!.detectSupport().marginBoxes,
			};
		});
		expect(result).toEqual({
			polyfilled: true,
			pageCount: 2,
			rendered: 2,
			pages: 2,
			support: "boolean",
		});
		await page.close();
	});
});
