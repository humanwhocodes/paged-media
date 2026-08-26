/**
 * @fileoverview Tests for paged media value parsers.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { parseComponentValues } from "./parser.js";
import {
	parseNth,
	matchesNth,
	parsePageSelectors,
	compareSpecificity,
	parseLength,
	parsePageSize,
	parseContent,
	parseStringSet,
	formatCounter,
	isDynamicContent,
} from "./values.js";

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

const LETTER = { width: 816, height: 1056 };

function values(text: string) {
	return parseComponentValues(text);
}

//-----------------------------------------------------------------------------
// Tests
//-----------------------------------------------------------------------------

describe("parseNth()", () => {
	it("should parse keywords and expressions", () => {
		expect(parseNth("even")).toEqual({ a: 2, b: 0 });
		expect(parseNth("odd")).toEqual({ a: 2, b: 1 });
		expect(parseNth("3")).toEqual({ a: 0, b: 3 });
		expect(parseNth("2n+1")).toEqual({ a: 2, b: 1 });
		expect(parseNth("-n+3")).toEqual({ a: -1, b: 3 });
		expect(parseNth(" n ")).toEqual({ a: 1, b: 0 });
		expect(parseNth("+3n - 2")).toEqual({ a: 3, b: -2 });
	});

	it("should reject invalid expressions", () => {
		expect(parseNth("")).toBeUndefined();
		expect(parseNth("foo")).toBeUndefined();
		expect(parseNth("n+")).toBeUndefined();
	});
});

describe("matchesNth()", () => {
	it("should match indexes", () => {
		expect(matchesNth({ a: 0, b: 3 }, 3)).toBe(true);
		expect(matchesNth({ a: 0, b: 3 }, 4)).toBe(false);
		expect(matchesNth({ a: 2, b: 1 }, 1)).toBe(true);
		expect(matchesNth({ a: 2, b: 1 }, 2)).toBe(false);
		expect(matchesNth({ a: -1, b: 3 }, 2)).toBe(true);
		expect(matchesNth({ a: -1, b: 3 }, 4)).toBe(false);
		expect(matchesNth({ a: 2, b: 0 }, 4)).toBe(true);
	});
});

describe("parsePageSelectors()", () => {
	it("should parse the universal selector", () => {
		const selectors = parsePageSelectors([])!;
		expect(selectors).toHaveLength(1);
		expect(selectors[0].specificity).toEqual([0, 0, 0]);
	});

	it("should parse names and pseudo-classes with specificity", () => {
		const selectors = parsePageSelectors(
			values("chapter:first:left, :blank, :nth(2n+1), :recto"),
		)!;
		expect(selectors).toHaveLength(4);
		expect(selectors[0]).toMatchObject({
			name: "chapter",
			first: true,
			left: true,
			specificity: [1, 1, 1],
		});
		expect(selectors[1]).toMatchObject({
			blank: true,
			specificity: [0, 1, 0],
		});
		expect(selectors[2].nth).toEqual([{ a: 2, b: 1 }]);
		expect(selectors[2].specificity).toEqual([0, 1, 0]);
		expect(selectors[3]).toMatchObject({
			right: true,
			specificity: [0, 0, 1],
		});
	});

	it("should reject invalid selectors", () => {
		expect(parsePageSelectors(values(":unknown"))).toBeUndefined();
		expect(parsePageSelectors(values("a b"))).toBeUndefined();
		expect(parsePageSelectors(values(":nth(foo)"))).toBeUndefined();
	});
});

describe("compareSpecificity()", () => {
	it("should compare in order", () => {
		expect(compareSpecificity([1, 0, 0], [0, 9, 9])).toBeGreaterThan(0);
		expect(compareSpecificity([0, 1, 0], [0, 0, 5])).toBeGreaterThan(0);
		expect(compareSpecificity([0, 0, 1], [0, 0, 1])).toBe(0);
		expect(compareSpecificity([0, 0, 0], [0, 0, 1])).toBeLessThan(0);
	});
});

describe("parseLength()", () => {
	it("should convert absolute units to pixels", () => {
		expect(parseLength(values("1in")[0])).toBe(96);
		expect(parseLength(values("72pt")[0])).toBe(96);
		expect(parseLength(values("2.54cm")[0])).toBeCloseTo(96);
		expect(parseLength(values("25.4mm")[0])).toBeCloseTo(96);
		expect(parseLength(values("6pc")[0])).toBe(96);
		expect(parseLength(values("10px")[0])).toBe(10);
		expect(parseLength(values("0")[0])).toBe(0);
	});

	it("should convert em using the font size", () => {
		expect(parseLength(values("2em")[0], 12)).toBe(24);
	});

	it("should reject unsupported values", () => {
		expect(parseLength(values("10%")[0])).toBeUndefined();
		expect(parseLength(values("auto")[0])).toBeUndefined();
		expect(parseLength(values("5vw")[0])).toBeUndefined();
		expect(parseLength(undefined)).toBeUndefined();
	});
});

describe("parsePageSize()", () => {
	it("should parse named sizes and orientation", () => {
		expect(parsePageSize(values("A4"), LETTER)).toEqual({
			width: (210 * 96) / 25.4,
			height: (297 * 96) / 25.4,
		});
		expect(parsePageSize(values("A4 landscape"), LETTER)).toEqual({
			width: (297 * 96) / 25.4,
			height: (210 * 96) / 25.4,
		});
		expect(parsePageSize(values("landscape letter"), LETTER)).toEqual({
			width: 1056,
			height: 816,
		});
		expect(parsePageSize(values("portrait"), LETTER)).toEqual(LETTER);
		expect(parsePageSize(values("landscape"), LETTER)).toEqual({
			width: 1056,
			height: 816,
		});
	});

	it("should parse explicit lengths", () => {
		expect(parsePageSize(values("5in"), LETTER)).toEqual({
			width: 480,
			height: 480,
		});
		expect(parsePageSize(values("4in 6in"), LETTER)).toEqual({
			width: 384,
			height: 576,
		});
	});

	it("should use the default for auto", () => {
		expect(parsePageSize(values("auto"), LETTER)).toEqual(LETTER);
	});

	it("should reject invalid values", () => {
		expect(parsePageSize(values("A4 5in"), LETTER)).toBeUndefined();
		expect(
			parsePageSize(values("portrait landscape"), LETTER),
		).toBeUndefined();
		expect(parsePageSize(values("foo"), LETTER)).toBeUndefined();
		expect(parsePageSize(values("1in 2in 3in"), LETTER)).toBeUndefined();
	});
});

describe("parseContent()", () => {
	it("should parse none and normal", () => {
		expect(parseContent(values("none"))).toEqual({ type: "none" });
		expect(parseContent(values("normal"))).toEqual({ type: "normal" });
	});

	it("should parse strings, counters, and attr", () => {
		const content = parseContent(
			values(
				'"Page " counter(page) " of " counter(pages, upper-roman) attr(title)',
			),
		);
		expect(content).toEqual({
			type: "list",
			items: [
				{ type: "string", value: "Page " },
				{ type: "counter", name: "page", style: "decimal" },
				{ type: "string", value: " of " },
				{ type: "counter", name: "pages", style: "upper-roman" },
				{ type: "attr", name: "title" },
			],
		});
	});

	it("should parse paged media functions", () => {
		const content = parseContent(
			values(
				'string(title, first-except) element(header, last) content(before) target-counter(attr(href), page, lower-roman) target-text("#x", after) target-counters(attr(href), section, ".") leader(dotted) leader("_ ") counters(item, ".") open-quote url("a.png")',
			),
		);
		expect(content?.type).toBe("list");
		const items = content!.type === "list" ? content!.items : [];
		expect(items).toEqual([
			{ type: "string-ref", name: "title", assignment: "first-except" },
			{ type: "element", name: "header", assignment: "last" },
			{ type: "content", what: "before" },
			{
				type: "target-counter",
				target: { type: "attr", name: "href" },
				name: "page",
				style: "lower-roman",
			},
			{
				type: "target-text",
				target: { type: "url", url: "#x" },
				what: "after",
			},
			{
				type: "target-counters",
				target: { type: "attr", name: "href" },
				name: "section",
				separator: ".",
				style: "decimal",
			},
			{ type: "leader", pattern: "." },
			{ type: "leader", pattern: "_ " },
			{
				type: "counters",
				name: "item",
				separator: ".",
				style: "decimal",
			},
			{ type: "quote", which: "open-quote" },
			{ type: "url", url: "a.png" },
		]);
	});

	it("should preserve unknown values as raw", () => {
		const content = parseContent(values("linear-gradient(red, blue)"));
		expect(content).toEqual({
			type: "list",
			items: [{ type: "raw", css: "linear-gradient(red, blue)" }],
		});
	});

	it("should reject empty values", () => {
		expect(parseContent([])).toBeUndefined();
	});

	it("should ignore alt text", () => {
		const content = parseContent(values('"x" / "alt"'));
		expect(content).toEqual({
			type: "list",
			items: [{ type: "string", value: "x" }],
		});
	});
});

describe("isDynamicContent()", () => {
	it("should detect dynamic items", () => {
		expect(isDynamicContent(parseContent(values('"x"'))!)).toBe(false);
		expect(
			isDynamicContent(parseContent(values("counter(section)"))!),
		).toBe(false);
		expect(isDynamicContent(parseContent(values("counter(page)"))!)).toBe(
			true,
		);
		expect(isDynamicContent(parseContent(values("string(title)"))!)).toBe(
			true,
		);
		expect(isDynamicContent(parseContent(values("leader(dotted)"))!)).toBe(
			true,
		);
		expect(isDynamicContent({ type: "none" })).toBe(false);
	});
});

describe("parseStringSet()", () => {
	it("should parse none", () => {
		expect(parseStringSet(values("none"))).toEqual([]);
	});

	it("should parse multiple entries", () => {
		expect(
			parseStringSet(
				values(
					'title content(text), author "By " attr(data-author), plain',
				),
			),
		).toEqual([
			{ name: "title", items: [{ type: "content", what: "text" }] },
			{
				name: "author",
				items: [
					{ type: "string", value: "By " },
					{ type: "attr", name: "data-author" },
				],
			},
			{ name: "plain", items: [{ type: "content", what: "text" }] },
		]);
	});

	it("should reject invalid entries", () => {
		expect(parseStringSet(values('"x"'))).toBeUndefined();
		expect(parseStringSet(values("title foo(bar)"))).toBeUndefined();
	});
});

describe("formatCounter()", () => {
	it("should format counter styles", () => {
		expect(formatCounter(4)).toBe("4");
		expect(formatCounter(4, "lower-roman")).toBe("iv");
		expect(formatCounter(1994, "upper-roman")).toBe("MCMXCIV");
		expect(formatCounter(1, "lower-alpha")).toBe("a");
		expect(formatCounter(27, "upper-latin")).toBe("AA");
		expect(formatCounter(7, "decimal-leading-zero")).toBe("07");
		expect(formatCounter(12, "decimal-leading-zero")).toBe("12");
		expect(formatCounter(3, "lower-greek")).toBe("γ");
		expect(formatCounter(3, "none")).toBe("");
		expect(formatCounter(0, "lower-roman")).toBe("0");
		expect(formatCounter(3, "unknown-style")).toBe("3");
	});
});
