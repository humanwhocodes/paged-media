/**
 * @fileoverview Regression tests derived from open bugs in the PagedJS issue
 * tracker (https://github.com/pagedjs/pagedjs/issues). Each test reproduces
 * the scenario from an issue and asserts the behavior the CSS Paged Media
 * specs (and the issue reporters) expect. Issue numbers are in the test
 * names so they can be cross referenced.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { describe, it, expect, afterAll } from "vitest";
import type { Page } from "puppeteer";
import {
	openFixture,
	runPolyfill,
	closeBrowser,
	printToPdf,
} from "./helpers/browser.js";

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

/**
 * Wraps a style block and body in a document using the test fonts and a
 * 4in x 4in page with 0.5in margins (a 288px x 288px page area, 14 lines
 * of 20px text).
 * @param style Extra CSS.
 * @param body The body HTML.
 * @param attrs Extra attributes for the body element.
 * @returns The HTML document.
 */
function doc(style: string, body: string, attrs = ""): string {
	return `<!doctype html><html lang="en"><head><style>
		@page { size: 4in 4in; margin: 0.5in; }
		body { margin: 0; font: 14px/20px "Test Mono"; }
		p, h1, h2, h3, pre, figure, table { margin: 0; }
		.tall { height: 240px; }
		${style}
	</style></head><body ${attrs}>${body}</body></html>`;
}

/**
 * Returns whether every element matching the selector is fully inside the
 * page area of its page (not clipped by the page's overflow: hidden).
 * @param page The page.
 * @param selector The selector, evaluated inside each `.pm-page`.
 * @returns Descriptions of elements that are clipped (empty if none).
 */
function findClipped(page: Page, selector: string): Promise<string[]> {
	return page.evaluate(sel => {
		const clipped: string[] = [];

		for (const pageEl of document.querySelectorAll(".pm-page")) {
			const body = pageEl
				.querySelector(".pm-body")!
				.getBoundingClientRect();

			for (const el of pageEl.querySelectorAll<HTMLElement>(sel)) {
				const rects = [...el.getClientRects()];

				if (!rects.length) {
					clipped.push(
						`${sel} "${el.textContent?.trim()}" has no box`,
					);
					continue;
				}

				for (const rect of rects) {
					if (
						rect.height &&
						(rect.bottom > body.bottom + 0.5 ||
							rect.top < body.top - 0.5)
					) {
						clipped.push(
							`${sel} "${el.textContent?.trim().slice(0, 30)}" ${rect.top}-${rect.bottom} outside ${body.top}-${body.bottom}`,
						);
						break;
					}
				}
			}
		}

		return clipped;
	}, selector);
}

/**
 * Returns the text of every text node inside the page bodies, checking
 * that all of it is rendered inside its page area (a text node that is
 * clipped by the page box is invisible in print).
 * @param page The page.
 * @returns Descriptions of clipped text nodes (empty if none).
 */
function findClippedText(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		const clipped: string[] = [];

		for (const pageEl of document.querySelectorAll(".pm-page")) {
			const bodyEl = pageEl.querySelector(".pm-body")!;
			const body = bodyEl.getBoundingClientRect();
			const walker = document.createTreeWalker(
				bodyEl,
				NodeFilter.SHOW_TEXT,
			);
			let node: Node | null;

			while ((node = walker.nextNode())) {
				if (!node.textContent?.trim()) {
					continue;
				}

				const range = document.createRange();
				range.selectNodeContents(node);

				for (const rect of range.getClientRects()) {
					if (
						rect.height &&
						(rect.bottom > body.bottom + 0.5 ||
							rect.top < body.top - 0.5)
					) {
						clipped.push(
							`"${node.textContent.trim().slice(0, 30)}" ${rect.top}-${rect.bottom} outside ${body.top}-${body.bottom}`,
						);
						break;
					}
				}
			}
		}

		return clipped;
	});
}

//-----------------------------------------------------------------------------
// Tests
//-----------------------------------------------------------------------------

afterAll(closeBrowser);

describe("PagedJS issues", () => {
	//-------------------------------------------------------------------------
	// Named pages and page selectors
	//-------------------------------------------------------------------------

	it("#348: page: auto should unset a named page", async () => {
		const page = await openFixture(
			doc(
				`h2 { page: title; }
				h2.inline { page: auto; }
				h2.initial { page: initial; }
				@page title { margin: 1in; }`,
				`<p>Intro</p>
				<h2>Header one</h2>
				<h2 class="inline">Header two</h2>
				<h2>Header three</h2>
				<h2 class="initial">Header four</h2>`,
			),
			true,
		);
		const result = await runPolyfill(page, { force: true });

		expect(result.errors).toEqual([]);
		expect(result.pages.map(p => [p.body, p.name])).toEqual([
			["Intro", null],
			["Header one", "title"],
			["Header two", null],
			["Header three", "title"],
			["Header four", null],
		]);
		await page.close();
	});

	it("#222: @page should accept a selector list", async () => {
		const page = await openFixture(
			doc(
				`.a { page: A; } .b { page: B; } .c { page: C; }
				@page A, B, C:first { margin: 1in; }`,
				`<div class="a">A</div><div class="b">B</div>
				<div class="c">C1<div style="height: 200px"></div><div style="height: 200px">C2</div></div>`,
			),
			true,
		);
		const result = await runPolyfill(page, { force: true });
		const widths = await page.evaluate(() =>
			[...document.querySelectorAll(".pm-page .pm-body")].map(
				body => body.getBoundingClientRect().width,
			),
		);

		expect(result.errors).toEqual([]);
		expect(result.pages.map(p => p.name)).toEqual(["A", "B", "C", "C"]);
		expect(widths).toEqual([192, 192, 192, 288]);
		await page.close();
	});

	it("#225: page names set through a child combinator on body should apply", async () => {
		const page = await openFixture(
			doc(
				`body > aside { page: interlude; break-before: page; }
				@page interlude { margin: 1in; }`,
				`<p>Main</p><aside>Interlude</aside><p>More</p>`,
			),
			true,
		);
		const result = await runPolyfill(page, { force: true });

		expect(result.errors).toEqual([]);
		expect(result.pages.map(p => [p.body, p.name])).toEqual([
			["Main", null],
			["Interlude", "interlude"],
			["More", null],
		]);
		await page.close();
	});

	it("#281/#6: named pages with different orientations should print at their own size", async () => {
		const page = await openFixture(
			doc(
				`@page wide { size: 6in 4in; }
				.wide { page: wide; }`,
				`<p>Portrait</p><p class="wide">Landscape</p><p>Portrait again</p>`,
			),
			true,
		);
		const result = await runPolyfill(page, { force: true });

		expect(result.errors).toEqual([]);
		expect(result.pages.map(p => [p.width, p.height])).toEqual([
			[384, 384],
			[576, 384],
			[384, 384],
		]);

		const pdf = await printToPdf(page);
		expect(pdf.map(p => [p.width, p.height])).toEqual([
			[288, 288],
			[432, 288],
			[288, 288],
		]);
		await page.close();
	});

	it("#212: @page rules inside unknown at-rules and @media screen should be ignored", async () => {
		const page = await openFixture(
			doc(
				`@page { margin: 1in; }
				@bogus print { @page { margin: 0; } }
				@media screen { @page { margin: 0; } }
				@media print { @page { size: 4in 4in; } }`,
				`<p>content</p>`,
			),
			true,
		);
		const result = await runPolyfill(page, { force: true });
		const width = await page.evaluate(
			() =>
				document
					.querySelector(".pm-page .pm-body")!
					.getBoundingClientRect().width,
		);

		expect(result.errors).toEqual([]);
		expect(width).toBe(192);
		await page.close();
	});

	it("#259: page size using custom properties should work", async () => {
		const page = await openFixture(
			`<!doctype html><html><head><style>
				:root { --page-width: 5in; --page-height: 4in; }
				@page { size: var(--page-width) var(--page-height); margin: 0.5in; }
			</style></head><body><p>content</p></body></html>`,
			true,
		);
		const result = await runPolyfill(page, { force: true });

		expect(result.errors).toEqual([]);
		expect(result.pages.map(p => [p.width, p.height])).toEqual([
			[480, 384],
		]);
		await page.close();
	});

	it("#180: counter-increment inside @page should not break rendering", async () => {
		const page = await openFixture(
			doc(
				`body { counter-reset: xyz; }
				@page { counter-increment: xyz; @top-left { content: "P" counter(page); } }
				.break { break-before: page; }`,
				`<p>one</p><p class="break">two</p>`,
			),
			true,
		);
		const result = await runPolyfill(page, { force: true });

		expect(result.errors).toEqual([]);
		expect(result.pages.map(p => p.boxes["top-left"])).toEqual([
			"P1",
			"P2",
		]);
		await page.close();
	});

	//-------------------------------------------------------------------------
	// Page counters
	//-------------------------------------------------------------------------

	it("#300/#43: counter-reset: page on an element should restart numbering persistently", async () => {
		const page = await openFixture(
			doc(
				`@page { @bottom-center { content: counter(page); } }
				h1 { break-before: page; counter-reset: page 1; }
				.half { height: 200px; }`,
				`<h1>A</h1><div class="half">a1</div><div class="half">a2</div>
				<h1>B</h1><div class="half">b1</div><div class="half">b2</div>
				<h1>C</h1>`,
			),
			true,
		);
		const result = await runPolyfill(page, { force: true });

		expect(result.errors).toEqual([]);
		expect(
			result.pages.map(p => [p.body, p.boxes["bottom-center"]]),
		).toEqual([
			["Aa1", "1"],
			["a2", "2"],
			["Bb1", "1"],
			["b2", "2"],
			["C", "1"],
		]);
		await page.close();
	});

	it("#91/#4: counter-reset: footnote in @page should not affect target-counter(page)", async () => {
		const page = await openFixture(
			doc(
				`@page { counter-reset: footnote 0; }
				.fn { float: footnote; }
				.toc a::after { content: " p." target-counter(attr(href url), page); }
				h1 { break-before: page; }`,
				`<p class="toc"><a id="l1" href="#c1">One</a><br><a id="l2" href="#c2">Two</a></p>
				<h1 id="c1">Chapter 1<span class="fn">note</span></h1>
				<h1 id="c2">Chapter 2<span class="fn">note</span></h1>`,
			),
			true,
		);
		const result = await runPolyfill(page);
		const after = await page.evaluate(() =>
			["l1", "l2"].map(
				id =>
					getComputedStyle(
						document.querySelector(`.pm-page #${id}`)!,
						"::after",
					).content,
			),
		);

		expect(result.errors).toEqual([]);
		expect(result.pages).toHaveLength(3);
		expect(after).toEqual(['" p.2"', '" p.3"']);
		expect(result.pages.map(p => p.footnotes)).toEqual([
			"",
			"1note",
			"1note",
		]);
		await page.close();
	});

	it("#145: target-counter(page) in a table of contents should not be zero", async () => {
		const page = await openFixture(
			doc(
				`ol.toc a::after { content: "p. " target-counter(attr(href), page); float: right; }
				h1 { break-before: page; }`,
				`<ol class="toc"><li><a id="l1" href="#c1">One</a></li><li><a id="l2" href="#c2">Two</a></li></ol>
				<h1 id="c1">Chapter 1</h1><h1 id="c2">Chapter 2</h1>`,
			),
			true,
		);
		const result = await runPolyfill(page);
		const after = await page.evaluate(() =>
			["l1", "l2"].map(
				id =>
					getComputedStyle(
						document.querySelector(`.pm-page #${id}`)!,
						"::after",
					).content,
			),
		);

		expect(result.errors).toEqual([]);
		expect(after).toEqual(['"p. 2"', '"p. 3"']);
		await page.close();
	});

	//-------------------------------------------------------------------------
	// Document counters
	//-------------------------------------------------------------------------

	it("#286/#135/#179/#252: CSS counters should continue across pages", async () => {
		const items = Array.from(
			{ length: 12 },
			() => `<li>Item<ol><li>Sub</li></ol></li>`,
		).join("");
		const page = await openFixture(
			doc(
				`.wrapper ol { counter-reset: item; list-style: none; padding: 0; margin: 0; }
				.wrapper ol > li { display: block; }
				.wrapper ol > li::before { content: counters(item, ".") " "; counter-increment: item; }
				h2::before { content: "Section " counter(section) ": "; }
				h2 { counter-increment: section; }`,
				`<h2>First</h2><div class="wrapper"><ol>${items}</ol></div><h2>Second</h2>`,
			),
			true,
		);
		const result = await runPolyfill(page, { force: true });

		expect(result.errors).toEqual([]);
		expect(result.pages).toHaveLength(2);

		const pdf = await printToPdf(page);
		expect(pdf[0].text).toContain("Section 1: First");
		expect(pdf[0].text).toContain("1 Item 1.1 Sub 2 Item 2.1 Sub");
		expect(pdf[0].text).toMatch(/7 Item$/);
		expect(pdf[1].text).toMatch(/^7\.1 Sub 8 Item 8\.1 Sub/);
		expect(pdf[1].text).toContain("12 Item 12.1 Sub");
		expect(pdf[1].text).toContain("Section 2: Second");
		await page.close();
	});

	it("#221/#220: string-set should accept counter() values", async () => {
		const page = await openFixture(
			doc(
				`h2 { counter-increment: chapter; string-set: chap counter(chapter, upper-roman); break-before: page; }
				@page { @top-right { content: string(chap, first); } }`,
				`<h2>One</h2><h2>Two</h2><h2>Three</h2>`,
			),
			true,
		);
		const result = await runPolyfill(page);

		expect(result.errors).toEqual([]);
		expect(result.pages.map(p => p.boxes["top-right"])).toEqual([
			"I",
			"II",
			"III",
		]);
		await page.close();
	});

	//-------------------------------------------------------------------------
	// Breaks
	//-------------------------------------------------------------------------

	it("#311/#249: break-before: page should work with an inline style attribute", async () => {
		const page = await openFixture(
			doc(
				`.chapter { break-before: page; }`,
				`<section class="chapter" style="color: rgb(255, 0, 0);"><h1>Chapitre 1</h1></section>
				<section class="chapter"><h1>Chapitre 2</h1></section>`,
			),
			true,
		);
		const result = await runPolyfill(page, { force: true });
		const color = await page.evaluate(
			() =>
				getComputedStyle(document.querySelector(".pm-page h1")!).color,
		);

		expect(result.errors).toEqual([]);
		expect(result.pages.map(p => p.body)).toEqual([
			"Chapitre 1",
			"Chapitre 2",
		]);
		expect(color).toBe("rgb(255, 0, 0)");
		await page.close();
	});

	it("#295: break-inside: avoid-page should keep an element on one page", async () => {
		const page = await openFixture(
			doc(
				`.box { break-inside: avoid-page; }
				.tall { height: 200px; }`,
				`<div class="tall">filler</div>
				<div class="box"><p>L1</p><p>L2</p><p>L3</p><p>L4</p><p>L5</p><p>L6</p></div>`,
			),
			true,
		);
		const result = await runPolyfill(page, { force: true });

		expect(result.errors).toEqual([]);
		expect(result.pages.map(p => p.body)).toEqual([
			"filler",
			"L1L2L3L4L5L6",
		]);
		await page.close();
	});

	it("#31: break-inside: avoid should keep a grid together", async () => {
		const items = Array.from(
			{ length: 8 },
			(_, i) => `<div>I${i + 1}</div>`,
		).join("");
		const page = await openFixture(
			doc(
				`.grid { display: grid; grid-template-columns: 1fr 1fr; break-inside: avoid; }
				.grid > div { height: 60px; }
				.tall { height: 100px; }`,
				`<div class="tall">filler</div><div class="grid">${items}</div>`,
			),
			true,
		);
		const result = await runPolyfill(page, { force: true });

		expect(result.errors).toEqual([]);
		expect(result.pages.map(p => p.body)).toEqual([
			"filler",
			"I1I2I3I4I5I6I7I8",
		]);
		await page.close();
	});

	it("#271: a tall element after a short paragraph should move to the next page", async () => {
		const page = await openFixture(
			doc(
				``,
				`<p>Just a little text to fill our page.</p>
				<div id="block" style="width: 3cm; height: 280px; background-color: red;"></div>`,
			),
			true,
		);
		const result = await runPolyfill(page, { force: true });
		const where = await page.evaluate(() =>
			[...document.querySelectorAll(".pm-page")].map(
				p => p.querySelectorAll("#block").length,
			),
		);

		expect(result.errors).toEqual([]);
		expect(result.pages).toHaveLength(2);
		expect(where).toEqual([0, 1]);
		expect(result.pages.every(p => p.overflow <= 0)).toBe(true);
		await page.close();
	});

	it("#229: an explicitly sized element crossing the page end should move intact", async () => {
		const page = await openFixture(
			doc(
				`.sized { height: 100px; border: 1px solid black; }`,
				`<div class="tall">filler</div>
				<div class="sized"><svg width="50" height="50"><rect width="50" height="50"/></svg></div>
				<p>after</p>`,
			),
			true,
		);
		const result = await runPolyfill(page, { force: true });
		const sized = await page.evaluate(() =>
			[...document.querySelectorAll(".pm-page")].map(p =>
				[...p.querySelectorAll(".sized")].map(
					el => el.getBoundingClientRect().height,
				),
			),
		);

		expect(result.errors).toEqual([]);
		expect(sized).toEqual([[], [102]]);
		expect(result.pages[1].body).toBe("after");
		expect(await findClipped(page, "svg")).toEqual([]);
		await page.close();
	});

	it("#279: a figure with an image near the bottom should move without losing the image", async () => {
		const page = await openFixture(
			doc(
				`img { display: block; width: 100px; height: 100px; }`,
				`<div class="tall">filler</div>
				<figure><img alt="pic" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="><figcaption>Caption</figcaption></figure>`,
			),
			true,
		);
		const result = await runPolyfill(page, { force: true });
		const images = await page.evaluate(() =>
			[...document.querySelectorAll(".pm-page")].map(
				p => p.querySelectorAll("img").length,
			),
		);

		expect(result.errors).toEqual([]);
		expect(images).toEqual([0, 1]);
		expect(result.pages[1].body).toBe("Caption");
		expect(await findClipped(page, "img")).toEqual([]);
		await page.close();
	});

	it("#153: a floated image near the bottom should not be clipped", async () => {
		const page = await openFixture(
			doc(
				`img { float: right; width: 100px; height: 100px; }
				.tall { height: 200px; }`,
				`<div class="tall">filler</div>
				<p><img alt="pic" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="> Text next to the picture that goes on for several lines so that the paragraph is taller than the space that remains on the page.</p>`,
			),
			true,
		);
		const result = await runPolyfill(page, { force: true });

		expect(result.errors).toEqual([]);
		expect(await findClipped(page, "img")).toEqual([]);
		expect(await findClippedText(page)).toEqual([]);
		expect(result.pages.map(p => p.body).join(" ")).toContain(
			"Text next to the picture",
		);
		await page.close();
	});

	it("#301: a running element should not produce a blank page", async () => {
		const page = await openFixture(
			doc(
				`.footer { position: running(footerRunning); }
				.toc { break-before: page; }
				@page { @bottom-left { content: element(footerRunning); } }`,
				`<div class="footer"><div>line1</div><div>line2</div></div>
				<div class="cover">cover</div>
				<div class="toc">toc</div>`,
			),
			true,
		);
		const result = await runPolyfill(page);

		expect(result.errors).toEqual([]);
		expect(result.pages.map(p => [p.body, p.boxes["bottom-left"]])).toEqual(
			[
				["cover", "line1line2"],
				["toc", "line1line2"],
			],
		);
		await page.close();
	});

	it("#92: each running element instance should apply to its own pages", async () => {
		const chapter = (n: number) =>
			`<section class="chapter"><h1>Chapter ${n}</h1>
			<header class="hdr">Chapter ${n} continued</header>
			<div class="tall">text</div><div class="tall">more</div></section>`;
		const page = await openFixture(
			doc(
				`.chapter { page: chapter; break-after: page; }
				.hdr { position: running(hdr); }
				.footer { position: running(footer); }
				.num::after { content: counter(page); }
				.total::after { content: counter(pages); }
				@page chapter { @top-right { content: element(hdr); } }
				@page { @bottom-right { content: element(footer); } }`,
				`<footer class="footer">Page <span class="num"></span> of <span class="total"></span></footer>
				${chapter(1)}${chapter(2)}${chapter(3)}`,
			),
			true,
		);
		const result = await runPolyfill(page);
		const footers = await page.evaluate(() =>
			[...document.querySelectorAll(".pm-page")].map(p => {
				const num = p.querySelector(".pm-bottom-right .num")!;
				const total = p.querySelector(".pm-bottom-right .total")!;
				return (
					getComputedStyle(num, "::after").content +
					"/" +
					getComputedStyle(total, "::after").content
				);
			}),
		);

		expect(result.errors).toEqual([]);
		expect(result.pages.map(p => p.boxes["top-right"])).toEqual([
			"Chapter 1 continued",
			"Chapter 1 continued",
			"Chapter 2 continued",
			"Chapter 2 continued",
			"Chapter 3 continued",
			"Chapter 3 continued",
		]);
		expect(footers).toEqual([
			'"1"/"6"',
			'"2"/"6"',
			'"3"/"6"',
			'"4"/"6"',
			'"5"/"6"',
			'"6"/"6"',
		]);
		await page.close();
	});

	//-------------------------------------------------------------------------
	// Text splitting
	//-------------------------------------------------------------------------

	it("#349/#52: text-align-last should only be overridden on split fragments", async () => {
		const page = await openFixture(
			doc(
				`p { text-align: justify; text-align-last: left; }
				.tall { height: 220px; }`,
				`<div class="tall">filler</div>
				<p id="whole">Short and complete.</p>
				<p id="split">First line of the paragraph<br>Second line of the paragraph<br>Third line<br>Fourth line<br>Fifth line<br>Sixth line</p>
				<p id="last">Another complete paragraph.</p>`,
			),
			true,
		);
		const result = await runPolyfill(page, { force: true });
		const aligns = await page.evaluate(() =>
			[...document.querySelectorAll<HTMLElement>(".pm-page p")].map(
				p => ({
					id: p.id,
					split: p.hasAttribute("data-pm-split-after"),
					continued: p.hasAttribute("data-pm-continued"),
					last: getComputedStyle(p).textAlignLast,
				}),
			),
		);

		expect(result.errors).toEqual([]);
		expect(result.pages).toHaveLength(2);
		expect(aligns).toEqual([
			{ id: "whole", split: false, continued: false, last: "left" },
			{ id: "split", split: true, continued: false, last: "justify" },
			{ id: "", split: false, continued: true, last: "left" },
			{ id: "last", split: false, continued: false, last: "left" },
		]);
		await page.close();
	});

	it("#339/#45/#75/#302: preformatted text should keep whitespace and lines across a split", async () => {
		const lines = [
			"line one",
			"    indented two",
			"        indented three",
			"line four",
			"    indented five",
			"        indented six",
			"line seven",
		];
		const page = await openFixture(
			doc(
				`.tall { height: 200px; }`,
				`<div class="tall">filler</div><pre><code>${lines.join("\n")}</code></pre>`,
			),
			true,
		);
		const result = await runPolyfill(page, { force: true });
		const pres = await page.evaluate(() =>
			[...document.querySelectorAll(".pm-page pre")].map(
				pre => pre.textContent,
			),
		);

		expect(result.errors).toEqual([]);
		expect(result.pages).toHaveLength(2);
		expect(pres).toHaveLength(2);
		expect(pres[0]!.split("\n").filter(Boolean)).toEqual(lines.slice(0, 4));
		expect(pres[1]!.split("\n").filter(Boolean)).toEqual(lines.slice(4));
		expect(await findClipped(page, "pre")).toEqual([]);
		expect(await findClippedText(page)).toEqual([]);
		await page.close();
	});

	it("#322: a split code block should stay visible on the first page", async () => {
		const code = Array.from(
			{ length: 30 },
			(_, i) => `function greet${i}(name) {\n    return name;\n}`,
		).join("\n");
		const page = await openFixture(
			doc(
				`pre { background: #eee; }`,
				`<p>Hello</p><pre><code class="language-javascript">${code}</code></pre>`,
			),
			true,
		);
		const result = await runPolyfill(page, { force: true });
		const heights = await page.evaluate(() =>
			[...document.querySelectorAll<HTMLElement>(".pm-page pre")].map(
				pre => ({
					height: pre.getBoundingClientRect().height,
					visibility: getComputedStyle(pre).visibility,
					lines: pre.textContent!.split("\n").filter(Boolean).length,
				}),
			),
		);

		expect(result.errors).toEqual([]);
		expect(result.pages.length).toBeGreaterThan(3);
		expect(
			heights.every(h => h.height > 0 && h.visibility === "visible"),
		).toBe(true);
		expect(heights.reduce((sum, h) => sum + h.lines, 0)).toBe(90);
		expect(await findClippedText(page)).toEqual([]);
		await page.close();
	});

	it("#285: whitespace between inline elements should be preserved", async () => {
		const page = await openFixture(
			doc(
				`.tall { height: 240px; } p { orphans: 1; widows: 1; }`,
				`<p id="p1">Text <em>emph</em> <span>after</span> <strong>bold</strong> end</p>
				<div class="tall">filler</div>
				<p id="p2"><em>emph</em> <span>after</span> <strong>bold</strong><br><i>x</i> <b>y</b> <u>z</u> end</p>`,
			),
			true,
		);
		const result = await runPolyfill(page, { force: true });

		expect(result.errors).toEqual([]);
		expect(result.pages[0].body).toBe(
			"Text emph after bold end filler emph after bold",
		);
		expect(result.pages[1].body).toBe("x y z end");
		await page.close();
	});

	it("#208: text should not be duplicated when the same phrase repeats near a break", async () => {
		const phrase = "This phrase is defined twice";
		const filler = Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ");
		const page = await openFixture(
			doc(
				``,
				`<main>${phrase} <br>in the code. ${filler}<br><br>${phrase} and the rest. ${filler} ${filler} ${filler} ${filler}<br><br>Final ${phrase}.</main>`,
			),
			true,
		);
		const result = await runPolyfill(page, { force: true });
		const joined = result.pages.map(p => p.body).join(" ");

		expect(result.errors).toEqual([]);
		expect(result.pages.length).toBeGreaterThan(1);
		expect(joined.split(phrase)).toHaveLength(4);
		expect(joined.match(/w39(?!\d)/g)).toHaveLength(5);
		expect(await findClippedText(page)).toEqual([]);
		await page.close();
	});

	it("#167: paragraphs with borders, padding, and margins should not lose lines", async () => {
		const words = Array.from({ length: 300 }, (_, i) => `w${i}`).join(" ");
		const page = await openFixture(
			doc(
				`p { padding: 6px; border: 2px solid black; margin-bottom: 12px; }`,
				`<p>${words}</p><p>${words}</p>`,
			),
			true,
		);
		const result = await runPolyfill(page, { force: true });
		const joined = result.pages.map(p => p.body).join(" ");

		expect(result.errors).toEqual([]);
		expect(joined.match(/w\d+/g)).toEqual(`${words} ${words}`.split(" "));
		expect(result.pages.every(p => p.overflow <= 0)).toBe(true);
		expect(await findClippedText(page)).toEqual([]);
		await page.close();
	});

	it("#87: hyphenated text with paragraph margins should not lose lines", async () => {
		const words = Array.from(
			{ length: 120 },
			(_, i) => `internationalization${i} extraordinarily`,
		).join(" ");
		const page = await openFixture(
			doc(
				`body { hyphens: auto; } p { margin-bottom: 12px; }`,
				`<p>${words}</p><p>${words}</p>`,
			),
			true,
		);
		const result = await runPolyfill(page, { force: true });
		const joined = result.pages.map(p => p.body).join(" ");

		expect(result.errors).toEqual([]);
		expect(
			joined.replace(/­/g, "").match(/internationalization\d+/g),
		).toEqual(`${words} ${words}`.match(/internationalization\d+/g));
		expect(await findClippedText(page)).toEqual([]);
		await page.close();
	});

	it("#308/#25: right-to-left documents should paginate", async () => {
		const para = Array.from({ length: 60 }, (_, i) => `كلمة${i}`).join(" ");
		const page = await openFixture(
			doc(
				`body { font-family: "Test Sans"; }`,
				`<p>${para}</p><p>${para}</p><p>${para}</p>`,
				`dir="rtl"`,
			),
			true,
		);
		const result = await runPolyfill(page, { force: true });
		const direction = await page.evaluate(
			() =>
				getComputedStyle(document.querySelector(".pm-page p")!)
					.direction,
		);

		expect(result.errors).toEqual([]);
		expect(result.pages.length).toBeGreaterThan(1);
		expect(direction).toBe("rtl");
		expect(
			result.pages
				.map(p => p.body)
				.join(" ")
				.match(/كلمة\d+/g),
		).toEqual(`${para} ${para} ${para}`.split(" "));
		expect(await findClippedText(page)).toEqual([]);
		await page.close();
	});

	it("#50: list bullets should not be left behind at the end of a page", async () => {
		const items = Array.from(
			{ length: 8 },
			(_, i) => `<li>Item ${i + 1} first line<br>second line</li>`,
		).join("");
		const page = await openFixture(
			doc(
				`ul { margin: 0; } .tall { height: 250px; }`,
				`<div class="tall">filler</div><ul>${items}</ul>`,
			),
			true,
		);
		const result = await runPolyfill(page, { force: true });
		const empty = await page.evaluate(
			() =>
				[...document.querySelectorAll(".pm-page li")].filter(
					li => !li.textContent!.trim(),
				).length,
		);

		expect(result.errors).toEqual([]);
		expect(empty).toBe(0);
		expect(result.pages.map(p => p.body).join(" ")).toContain("Item 8");
		expect(await findClippedText(page)).toEqual([]);
		await page.close();
	});

	//-------------------------------------------------------------------------
	// Tables
	//-------------------------------------------------------------------------

	it("#263/#232/#206: the last table row on a page should not be hidden", async () => {
		const rows = Array.from(
			{ length: 14 },
			(_, i) => `<tr><td>R${i + 1}</td><td>value</td></tr>`,
		).join("");
		const page = await openFixture(
			doc(
				`@page { @bottom-center { content: counter(page); border-top: 4px solid blue; } }
				h1 { margin-bottom: 7px; } p { margin-bottom: 13px; }
				table { border-collapse: collapse; }
				td { border: 1px solid black; padding: 3px 5px; }`,
				`<h1>Title</h1><p>Paragraph</p><table>${rows}</table>`,
			),
			true,
		);
		const result = await runPolyfill(page, { force: true });
		const joined = result.pages.map(p => p.body).join(" ");

		expect(result.errors).toEqual([]);
		expect(result.pages.length).toBeGreaterThan(1);

		for (let i = 1; i <= 14; i++) {
			expect(joined).toContain(`R${i}value`);
		}

		expect(await findClipped(page, "tr")).toEqual([]);
		expect(result.pages.every(p => p.overflow <= 0)).toBe(true);
		await page.close();
	});

	it("#251: cell content mixing text and inline elements should survive a split", async () => {
		const rows = Array.from(
			{ length: 12 },
			(_, i) =>
				`<tr><td>first:<span>F${i + 1}</span></td><td>second:<span>S${i + 1}</span></td></tr>`,
		).join("");
		const page = await openFixture(
			doc(`td { padding: 5px; }`, `<p>table</p><table>${rows}</table>`),
			true,
		);
		const result = await runPolyfill(page, { force: true });
		const joined = result.pages.map(p => p.body).join(" ");

		expect(result.errors).toEqual([]);
		expect(result.pages.length).toBeGreaterThan(1);

		for (let i = 1; i <= 12; i++) {
			expect(joined).toContain(`first:F${i}second:S${i}`);
		}

		await page.close();
	});

	it("#194: break-inside: avoid on tfoot should not move the whole table", async () => {
		const rows = Array.from(
			{ length: 16 },
			(_, i) => `<tr><td>R${i + 1}</td></tr>`,
		).join("");
		const page = await openFixture(
			doc(
				`tfoot { break-inside: avoid; }`,
				`<p>Intro</p><table><thead><tr><th>Head</th></tr></thead><tbody>${rows}</tbody>
				<tfoot><tr><td>Sub</td></tr><tr><td>Tax</td></tr><tr><td>Total</td></tr></tfoot></table>`,
			),
			true,
		);
		const result = await runPolyfill(page, { force: true });

		expect(result.errors).toEqual([]);
		expect(result.pages).toHaveLength(2);
		expect(result.pages[0].body).toMatch(/^IntroHeadR1R2/);
		expect(result.pages[0].body).not.toContain("Total");
		expect(result.pages[1].body).toMatch(/^HeadR\d+.*SubTaxTotal$/);
		expect(result.pages.map(p => p.body).join(" ")).toContain("R16");
		await page.close();
	});

	it("#188/#55: tables with colspan and rowspan should split without losing cells", async () => {
		const paragraphs = Array.from(
			{ length: 16 },
			(_, i) => `<p>para ${i + 1}</p>`,
		).join("");
		const page = await openFixture(
			doc(
				`td { vertical-align: top; border: 1px solid black; }`,
				`<table><tbody>
					<tr><td rowspan="2">side</td><td>123</td><td colspan="1">header:</td></tr>
					<tr><td colspan="2">${paragraphs}</td></tr>
					<tr><td>a</td><td>b</td><td>c</td></tr>
				</tbody></table>`,
			),
			true,
		);
		const result = await runPolyfill(page, { force: true });
		const joined = result.pages.map(p => p.body).join(" ");

		expect(result.errors).toEqual([]);
		expect(result.pages.length).toBeGreaterThan(1);
		expect(joined).toContain("side123header:");

		for (let i = 1; i <= 16; i++) {
			expect(
				joined.match(new RegExp(`para ${i}(?!\\d)`, "g")),
			).toHaveLength(1);
		}

		expect(joined).toMatch(/abc$/);
		expect(await findClippedText(page)).toEqual([]);
		await page.close();
	});

	it("#164: splitting a table should not create empty rows", async () => {
		const rows = Array.from(
			{ length: 6 },
			(_, i) =>
				`<tr><td>R${i + 1}</td><td>one<br>two<br>three<br>four</td></tr>`,
		).join("");
		const page = await openFixture(
			doc(
				`.tall { height: 120px; }`,
				`<div class="tall">filler</div><table>${rows}</table>`,
			),
			true,
		);
		const result = await runPolyfill(page, { force: true });
		const emptyRows = await page.evaluate(
			() =>
				[...document.querySelectorAll(".pm-page tr")].filter(
					tr => !tr.textContent!.trim(),
				).length,
		);

		expect(result.errors).toEqual([]);
		expect(emptyRows).toBe(0);
		expect(result.pages.map(p => p.body).join(" ")).toContain("R6");
		expect(await findClippedText(page)).toEqual([]);
		await page.close();
	});

	it("#170: column widths should be preserved when a table is split", async () => {
		const rows = [
			...Array.from(
				{ length: 10 },
				(_, i) => `<tr><td>a</td><td>a much longer cell ${i}</td></tr>`,
			),
			...Array.from(
				{ length: 10 },
				(_, i) => `<tr><td>a much longer cell ${i}</td><td>b</td></tr>`,
			),
		].join("");
		const page = await openFixture(
			doc(`table { width: 100%; }`, `<table>${rows}</table>`),
			true,
		);
		const result = await runPolyfill(page, { force: true });
		const widths = await page.evaluate(() =>
			[...document.querySelectorAll(".pm-page table")].map(
				table =>
					table.querySelector("td")!.getBoundingClientRect().width,
			),
		);

		expect(result.errors).toEqual([]);
		expect(widths.length).toBeGreaterThan(1);
		expect(widths.every(w => Math.abs(w - widths[0]) < 1)).toBe(true);
		expect(await findClipped(page, "tr")).toEqual([]);
		expect(result.pages.map(p => p.body).join(" ")).toContain(
			"a much longer cell 9b",
		);
		await page.close();
	});

	it("#340: many small tables with break-inside: avoid and a thead should render", async () => {
		const tables = Array.from(
			{ length: 10 },
			(_, i) =>
				`<h2>Section ${i + 1}</h2><table style="break-inside: avoid"><thead><tr><th>Head</th></tr></thead>
				<tbody><tr><td>a${i}</td></tr><tr><td>b${i}</td></tr><tr><td>c${i}</td></tr></tbody></table>`,
		).join("");
		const page = await openFixture(doc(``, tables), true);
		const result = await runPolyfill(page, { force: true });
		const joined = result.pages.map(p => p.body).join(" ");

		expect(result.errors).toEqual([]);
		expect(joined.match(/Head/g)).toHaveLength(10);
		expect(joined).toContain("c9");
		expect(result.pages.every(p => p.overflow <= 0)).toBe(true);
		await page.close();
	});

	//-------------------------------------------------------------------------
	// Footnotes
	//-------------------------------------------------------------------------

	it("#280/#59: footnote calls and markers should honor counter styles", async () => {
		const page = await openFixture(
			doc(
				`.fn { float: footnote; }
				.fn::footnote-call { content: counter(footnote, lower-alpha); vertical-align: super; font-size: 80%; }
				.fn::footnote-marker { content: counter(footnote, lower-alpha) ". "; }`,
				`<p>One<span class="fn">Note A</span> two<span class="fn">Note B</span> three<span class="fn">Note C</span>.</p>`,
			),
			true,
		);
		const result = await runPolyfill(page);
		const calls = await page.evaluate(() =>
			[...document.querySelectorAll(".pm-page .pm-footnote-call")].map(
				call => call.textContent,
			),
		);

		expect(result.errors).toEqual([]);
		expect(calls).toEqual(["a", "b", "c"]);
		expect(result.pages[0].footnotes).toBe("a. Note Ab. Note Bc. Note C");
		await page.close();
	});

	it("#66: footnote markers and calls should accept superscript styling", async () => {
		const page = await openFixture(
			doc(
				`.fn { float: footnote; }
				.fn::footnote-call { vertical-align: super; font-size: 70%; }
				.fn::footnote-marker { vertical-align: super; font-variant-position: super; }`,
				`<p>One<span class="fn">Note A</span>.</p>`,
			),
			true,
		);
		const result = await runPolyfill(page);
		const styles = await page.evaluate(() => {
			const call = document.querySelector(".pm-page .pm-footnote-call")!;
			const marker = document.querySelector(
				".pm-page .pm-footnote-marker",
			)!;
			return {
				callAlign: getComputedStyle(call).verticalAlign,
				callSize: getComputedStyle(call).fontSize,
				markerAlign: getComputedStyle(marker).verticalAlign,
				markerVariant: getComputedStyle(marker).fontVariantPosition,
			};
		});

		expect(result.errors).toEqual([]);
		expect(styles).toEqual({
			callAlign: "super",
			callSize: "9.8px",
			markerAlign: "super",
			markerVariant: "super",
		});
		await page.close();
	});

	it("#68: footnotes should support multiple paragraphs", async () => {
		const page = await openFixture(
			doc(
				`.fn { float: footnote; }
				.fn p { text-indent: 1em; }`,
				`<p>Text<div class="fn"><p>Para one.</p><p>Para two.</p></div> more.</p>`,
			),
			true,
		);
		const result = await runPolyfill(page);
		const info = await page.evaluate(() => {
			const note = document.querySelector(".pm-page .pm-footnotes .fn")!;
			return {
				paragraphs: note.querySelectorAll("p").length,
				indent: getComputedStyle(note.querySelector("p")!).textIndent,
			};
		});

		expect(result.errors).toEqual([]);
		expect(result.pages[0].body).toBe("Text1 more.");
		expect(result.pages[0].footnotes).toBe("1Para one.Para two.");
		expect(info).toEqual({ paragraphs: 2, indent: "14px" });
		await page.close();
	});

	it("#224: float: none from a more specific rule should cancel float: footnote", async () => {
		const page = await openFixture(
			doc(
				`cite { float: footnote; }
				figure cite { float: none; }`,
				`<p>Quote<cite>Source A</cite>.</p>
				<figure>Picture<cite>Source B</cite></figure>`,
			),
			true,
		);
		const result = await runPolyfill(page);

		expect(result.errors).toEqual([]);
		expect(result.pages[0].body).toBe("Quote1. PictureSource B");
		expect(result.pages[0].footnotes).toBe("1Source A");
		await page.close();
	});

	//-------------------------------------------------------------------------
	// Selectors
	//-------------------------------------------------------------------------

	it("#326: target-text should work with single-colon pseudo-element syntax", async () => {
		const page = await openFixture(
			doc(
				`.toc:before { content: target-text(attr(href url)); }
				.toc2:after { content: " (" target-counter(attr(href url), page) ")"; }
				h1 { break-before: page; }`,
				`<p><a id="l1" class="toc toc2" href="#ch1">See: </a></p><h1 id="ch1">Chapter One</h1>`,
			),
			true,
		);
		const result = await runPolyfill(page);
		const content = await page.evaluate(() => {
			const link = document.querySelector(".pm-page #l1")!;
			return [
				getComputedStyle(link, "::before").content,
				getComputedStyle(link, "::after").content,
			];
		});

		expect(result.errors).toEqual([]);
		expect(content).toEqual(['"Chapter One"', '" (2)"']);
		await page.close();
	});

	it("#323/#317: sibling combinators and :where() selectors should keep working", async () => {
		const page = await openFixture(
			doc(
				`.parent h5, .parent h6 { margin-top: 10pt; margin-bottom: 0; }
				.parent h5 + h6 { margin-top: 0; }
				:where(input, select, textarea, fieldset, .grid) + small { color: rgb(255, 0, 0); }
				:where(input, .grid)[aria-invalid=true] + small { color: rgb(0, 0, 255); }
				details.dropdown > summary + ul li:first-of-type { margin-top: 5px; }`,
				`<section class="parent"><h5>Header</h5><h6>Smaller header</h6></section>
				<div class="grid">grid</div><small id="s1">note</small>
				<div class="grid" aria-invalid="true">grid</div><small id="s2">bad</small>
				<details class="dropdown" open><summary>Sum</summary><ul><li id="li1">a</li><li>b</li></ul></details>`,
			),
			true,
		);
		const result = await runPolyfill(page, { force: true });
		const styles = await page.evaluate(() => {
			const get = (sel: string) =>
				getComputedStyle(document.querySelector(`.pm-page ${sel}`)!);
			return {
				h6: get("h6").marginTop,
				s1: get("#s1").color,
				s2: get("#s2").color,
				li1: get("#li1").marginTop,
			};
		});

		expect(result.errors).toEqual([]);
		expect(styles).toEqual({
			h6: "0px",
			s1: "rgb(255, 0, 0)",
			s2: "rgb(0, 0, 255)",
			li1: "5px",
		});
		await page.close();
	});
});
