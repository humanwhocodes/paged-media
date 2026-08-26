/**
 * @fileoverview Tests for stylesheet transformation.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { parseStylesheet } from "./css/parser.js";
import {
	transformStylesheets,
	customPropertyRegistrations,
} from "./transform.js";

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

function transform(css: string, options = {}) {
	return transformStylesheets([parseStylesheet(css)], options);
}

//-----------------------------------------------------------------------------
// Tests
//-----------------------------------------------------------------------------

describe("transformStylesheets()", () => {
	it("should throw for non-array input", () => {
		// @ts-expect-error testing invalid input
		expect(() => transformStylesheets("x")).toThrow(
			"Expected an array argument.",
		);
	});

	it("should extract @page rules and note their features", () => {
		const result = transform(`
			@page { size: A4; marks: crop; @top-center { content: string(title); } }
			@page :blank { }
			@page chapter:nth(2) { bleed: 3pt; }
			@footnote { border-top: 1px solid; }
			p { color: red; }
		`);
		expect(result.pageRules).toHaveLength(4);
		expect(result.css).not.toContain("@page");
		expect(result.css).toContain("p {");
		expect([...result.features].sort()).toEqual(
			[
				"bleed",
				"blankPages",
				"footnotes",
				"marginBoxes",
				"marks",
				"namedPages",
				"namedStrings",
				"nthPages",
				"pageSize",
			].sort(),
		);
	});

	it("should rewrite unsupported properties into custom properties", () => {
		const result = transform(`
			h1 { string-set: title content(text); }
			.fn { float: footnote; footnote-display: inline; footnote-policy: line; }
			.hdr { position: running(header); }
			.x { float: left; position: absolute; }
		`);
		expect(result.css).toContain("--pm-string-set: title content(text);");
		expect(result.css).toContain("--pm-float: footnote;");
		expect(result.css).toContain("--pm-footnote-display: inline;");
		expect(result.css).toContain("--pm-footnote-policy: line;");
		expect(result.css).toContain("--pm-running: header;");
		expect(result.css).toContain("float: left;");
		expect(result.css).toContain("position: absolute;");
		expect([...result.features].sort()).toEqual([
			"footnotes",
			"namedStrings",
			"runningElements",
		]);
	});

	it("should replace dynamic content with custom property references", () => {
		const result = transform(`
			a::after { content: " (p. " target-counter(attr(href), page) ")"; }
			li a::before { content: counter(item) ". "; }
			.toc a:after { content: leader(dotted) target-counter(attr(href), page); }
		`);
		expect(result.dynamicContent).toHaveLength(2);
		expect(result.dynamicContent[0]).toMatchObject({
			id: 0,
			selector: "a",
			pseudo: "after",
		});
		expect(result.dynamicContent[1]).toMatchObject({
			id: 1,
			selector: ".toc a",
			pseudo: "after",
		});
		expect(result.css).toContain("content: var(--pm-content-0);");
		expect(result.css).toContain('content: counter(item) ". ";');
		expect(result.css).toContain("width: var(--pm-leader-width-1, auto);");
		expect(result.css).toContain("display: inline-flex;");
		expect(result.features.has("crossReferences")).toBe(true);
		expect(result.features.has("leaders")).toBe(true);
	});

	it("should rewrite footnote pseudo-elements", () => {
		const result = transform(`
			.fn::footnote-call { content: "[" counter(footnote) "]"; color: red; }
			::footnote-marker { font-weight: bold; }
		`);
		expect(result.css).toContain(".fn > .pm-footnote-call {");
		expect(result.css).toContain("> .pm-footnote-marker {");
		expect(result.dynamicContent[0]).toMatchObject({
			selector: ".fn > .pm-footnote-call",
			pseudo: "footnote-call",
		});
	});

	it("should note left/right breaks and named pages", () => {
		const result = transform(`
			h1 { break-before: right; }
			h2 { page-break-after: left; }
			.c { page: chapter; }
			.d { page: auto; }
		`);
		expect(result.css).toContain("break-before: right;");
		expect([...result.features].sort()).toEqual([
			"leftRightBreaks",
			"namedPages",
		]);
	});

	it("should hoist @media print and drop @media screen", () => {
		const result = transform(`
			@media print { .p { color: red; } @page { margin: 0; } }
			@media screen { .s { color: blue; } }
			@media (min-width: 10px) { .m { color: green; } }
			@media not print { .n { color: black; } }
		`);
		expect(result.css).toContain(".p {");
		expect(result.css).not.toContain("@media print");
		expect(result.css).not.toContain(".s {");
		expect(result.css).toContain("@media (min-width: 10px) {");
		expect(result.css).toContain("@media not print {");
		expect(result.pageRules).toHaveLength(1);
	});

	it("should keep @media print when hoisting is disabled", () => {
		const result = transform("@media print { .p { color: red; } }", {
			hoistPrint: false,
		});
		expect(result.css).toContain("@media print {");
	});
});

describe("customPropertyRegistrations()", () => {
	it("should register non-inherited custom properties", () => {
		const css = customPropertyRegistrations();
		expect(css).toContain(
			'@property --pm-string-set { syntax: "*"; inherits: false; }',
		);
		expect(css).toContain("@property --pm-running");
	});
});
