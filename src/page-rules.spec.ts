/**
 * @fileoverview Tests for @page rule collection and cascade.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { parseStylesheet, serialize, type AtRule } from "./css/parser.js";
import {
	createPageRule,
	matchesPage,
	matchPageRules,
	resolvePageStyle,
	cascadeDeclarations,
	type PageContext,
	type PageRule,
} from "./page-rules.js";

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

const OPTIONS = {
	defaultSize: { width: 816, height: 1056 },
	defaultMargin: 48,
	fontSize: 16,
};

function rules(css: string): PageRule[] {
	return parseStylesheet(css)
		.rules.filter(
			(rule): rule is AtRule =>
				rule.type === "at" && rule.name === "page",
		)
		.map((rule, index) => createPageRule(rule, index)!)
		.filter(Boolean);
}

function context(overrides: Partial<PageContext> = {}): PageContext {
	return {
		index: 1,
		groupIndex: 1,
		first: true,
		blank: false,
		side: "right",
		...overrides,
	};
}

//-----------------------------------------------------------------------------
// Tests
//-----------------------------------------------------------------------------

describe("createPageRule()", () => {
	it("should throw for non-page rules", () => {
		const rule = parseStylesheet("@media print {}").rules[0] as AtRule;
		expect(() => createPageRule(rule, 0)).toThrow(
			"Expected an @page rule.",
		);
	});

	it("should collect declarations, margin boxes, and footnote areas", () => {
		const [rule] = rules(`
			@page :first {
				margin: 1in;
				@top-left { content: "a"; }
				@top-left { color: red; }
				@footnote { border-top: 1px solid; }
				@unknown-box { content: "x"; }
			}
		`);
		expect(rule.selectors[0].first).toBe(true);
		expect(rule.declarations.map(d => d.name)).toEqual(["margin"]);
		expect(rule.marginBoxes.get("top-left")?.map(d => d.name)).toEqual([
			"content",
			"color",
		]);
		expect(rule.footnote.map(d => d.name)).toEqual(["border-top"]);
		expect(rule.marginBoxes.size).toBe(1);
	});

	it("should return undefined for invalid selectors", () => {
		expect(rules("@page :bogus { margin: 0 }")).toEqual([]);
	});
});

describe("matchesPage()", () => {
	it("should match names and pseudo-classes", () => {
		const [rule] = rules("@page chapter:first:right { }");
		const selector = rule.selectors[0];
		expect(matchesPage(selector, context({ name: "chapter" }))).toBe(true);
		expect(matchesPage(selector, context({ name: "other" }))).toBe(false);
		expect(
			matchesPage(selector, context({ name: "chapter", side: "left" })),
		).toBe(false);
		expect(
			matchesPage(
				selector,
				context({
					name: "chapter",
					first: false,
					groupIndex: 2,
					index: 5,
				}),
			),
		).toBe(false);
		expect(
			matchesPage(
				selector,
				context({
					name: "chapter",
					first: false,
					groupIndex: 1,
					index: 5,
				}),
			),
		).toBe(true);
	});

	it("should match :first only for the document's first page when unnamed", () => {
		const [rule] = rules("@page :first { }");
		expect(
			matchesPage(
				rule.selectors[0],
				context({ first: false, groupIndex: 1 }),
			),
		).toBe(false);
		expect(matchesPage(rule.selectors[0], context({ first: true }))).toBe(
			true,
		);
	});

	it("should match :blank and :nth", () => {
		const [blank, nth, namedNth] = rules(
			"@page :blank { } @page :nth(2n) { } @page chapter:nth(2) { }",
		);
		expect(matchesPage(blank.selectors[0], context({ blank: true }))).toBe(
			true,
		);
		expect(matchesPage(blank.selectors[0], context({ blank: false }))).toBe(
			false,
		);
		expect(matchesPage(nth.selectors[0], context({ index: 4 }))).toBe(true);
		expect(matchesPage(nth.selectors[0], context({ index: 3 }))).toBe(
			false,
		);
		expect(
			matchesPage(
				namedNth.selectors[0],
				context({ name: "chapter", index: 7, groupIndex: 2 }),
			),
		).toBe(true);
		expect(
			matchesPage(
				namedNth.selectors[0],
				context({ name: "chapter", index: 2, groupIndex: 1 }),
			),
		).toBe(false);
	});
});

describe("matchPageRules()", () => {
	it("should order by specificity then source order", () => {
		const list = rules(`
			@page :left { }
			@page { }
			@page :first { }
			@page chapter { }
			@page :right { }
		`);
		const matched = matchPageRules(
			list,
			context({ name: "chapter", side: "right" }),
		);
		expect(matched.map(rule => rule.order)).toEqual([1, 4, 2, 3]);
	});

	it("should use the most specific matching selector of a rule", () => {
		const list = rules("@page :first, chapter:first { } @page chapter { }");
		const matched = matchPageRules(list, context({ name: "chapter" }));
		expect(matched.map(rule => rule.order)).toEqual([1, 0]);
	});
});

describe("cascadeDeclarations()", () => {
	it("should let later declarations win unless earlier ones are important", () => {
		const [a, b] = rules(
			"@page { margin: 1in !important; color: red } @page { margin: 2in; color: blue }",
		);
		const result = cascadeDeclarations([
			...a.declarations,
			...b.declarations,
		]);
		expect(result.map(d => `${d.name}:${serialize(d.value)}`)).toEqual([
			"margin:1in",
			"color:blue",
		]);
	});
});

describe("resolvePageStyle()", () => {
	it("should use defaults when nothing matches", () => {
		const style = resolvePageStyle([], context(), OPTIONS);
		expect(style.size).toEqual(OPTIONS.defaultSize);
		expect(style.margins).toEqual({
			top: 48,
			right: 48,
			bottom: 48,
			left: 48,
		});
		expect(style.bleed).toBe(0);
		expect(style.marks).toEqual({ crop: false, cross: false });
	});

	it("should resolve size, margins, marks, bleed, and counters", () => {
		const list = rules(`
			@page {
				size: 4in 6in;
				margin: 1in 2in;
				margin-left: 0.5in;
				marks: crop cross;
				bleed: 10px;
				counter-reset: page 4 foo;
				counter-increment: page 2;
				background: red;
			}
		`);
		const style = resolvePageStyle(list, context(), OPTIONS);
		expect(style.size).toEqual({ width: 384, height: 576 });
		expect(style.margins).toEqual({
			top: 96,
			right: 192,
			bottom: 96,
			left: 48,
		});
		expect(style.marks).toEqual({ crop: true, cross: true });
		expect(style.bleed).toBe(10);
		expect(style.counterReset).toEqual([
			["page", 4],
			["foo", 0],
		]);
		expect(style.counterIncrement).toEqual([["page", 2]]);
		expect(style.declarations.map(d => d.name)).toEqual(["background"]);
	});

	it("should default bleed to 6pt when crop marks are present", () => {
		const list = rules("@page { marks: crop }");
		expect(resolvePageStyle(list, context(), OPTIONS).bleed).toBe(8);
	});

	it("should cascade margin boxes across matching rules", () => {
		const list = rules(`
			@page { @top-center { content: "base"; color: red; } }
			@page :first { @top-center { content: "first"; } }
			@page :left { @top-center { content: "left"; } }
		`);
		const first = resolvePageStyle(
			list,
			context({ side: "left" }),
			OPTIONS,
		);
		const box = first.marginBoxes.get("top-center")!;
		expect(box.map(d => `${d.name}:${serialize(d.value)}`)).toEqual([
			'content:"first"',
			"color:red",
		]);

		const later = resolvePageStyle(
			list,
			context({ first: false, side: "left", index: 2 }),
			OPTIONS,
		);
		expect(serialize(later.marginBoxes.get("top-center")![0].value)).toBe(
			'"left"',
		);
	});

	it("should ignore invalid descriptor values", () => {
		const list = rules("@page { size: bogus; margin: 10%; }");
		const style = resolvePageStyle(list, context(), OPTIONS);
		expect(style.size).toEqual(OPTIONS.defaultSize);
		expect(style.margins.top).toBe(48);
	});
});
