/**
 * @fileoverview Tests for the CSS tokenizer and parser.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { tokenize } from "./tokenizer.js";
import {
	parseStylesheet,
	parseComponentValues,
	parseDeclarations,
	serializeStylesheet,
	serialize,
	quoteString,
	type AtRule,
	type StyleRule,
} from "./parser.js";

//-----------------------------------------------------------------------------
// Tests
//-----------------------------------------------------------------------------

describe("tokenize()", () => {
	it("should throw when the argument is not a string", () => {
		// @ts-expect-error testing invalid input
		expect(() => tokenize(42)).toThrow("Expected a string argument.");
	});

	it("should tokenize identifiers, numbers, dimensions, and percentages", () => {
		const tokens = tokenize("foo 12 1.5in -3% 2e3px");
		const types = tokens
			.filter(t => t.type !== "whitespace")
			.map(t => t.type);
		expect(types).toEqual([
			"ident",
			"number",
			"dimension",
			"percentage",
			"dimension",
		]);
		expect(tokens[2].number).toBe(12);
		expect(tokens[4].unit).toBe("in");
		expect(tokens[4].number).toBe(1.5);
		expect(tokens[6].number).toBe(-3);
		expect(tokens[8].number).toBe(2000);
	});

	it("should tokenize strings with escapes", () => {
		const tokens = tokenize(String.raw`"a\"b" 'c\41 d'`);
		expect(tokens[0]).toMatchObject({ type: "string", value: 'a"b' });
		expect(tokens[2]).toMatchObject({ type: "string", value: "cAd" });
	});

	it("should tokenize unquoted and quoted url()", () => {
		const tokens = tokenize("url(foo.png) url( 'bar.png' )");
		expect(tokens[0]).toMatchObject({ type: "url", value: "foo.png" });
		expect(tokens[2]).toMatchObject({
			type: "function-token",
			value: "url",
		});
	});

	it("should tokenize at-keywords, hashes, and functions", () => {
		const tokens = tokenize("@page #id counter(page)");
		expect(tokens[0]).toMatchObject({ type: "at-keyword", value: "page" });
		expect(tokens[2]).toMatchObject({ type: "hash", value: "id" });
		expect(tokens[4]).toMatchObject({
			type: "function-token",
			value: "counter",
		});
		expect(tokens[5]).toMatchObject({ type: "ident", value: "page" });
		expect(tokens[6]).toMatchObject({ type: ")" });
	});

	it("should skip comments and CDO/CDC", () => {
		const tokens = tokenize("<!-- a /* comment */ b -->");
		expect(
			tokens.filter(t => t.type !== "whitespace").map(t => t.value),
		).toEqual(["a", "b"]);
	});

	it("should handle escaped identifiers", () => {
		const tokens = tokenize(String.raw`\31 23 foo\:bar`);
		expect(tokens[0]).toMatchObject({ type: "ident", value: "123" });
		expect(tokens[2]).toMatchObject({ type: "ident", value: "foo:bar" });
	});
});

describe("parseStylesheet()", () => {
	it("should throw when the argument is not a string", () => {
		// @ts-expect-error testing invalid input
		expect(() => parseStylesheet(null)).toThrow(
			"Expected a string argument.",
		);
	});

	it("should parse style rules with declarations", () => {
		const sheet = parseStylesheet(
			"h1, h2 { color: red; margin: 0 !important }",
		);
		expect(sheet.rules).toHaveLength(1);
		const rule = sheet.rules[0] as StyleRule;
		expect(rule.type).toBe("style");
		expect(rule.selector).toBe("h1, h2");
		expect(rule.declarations).toHaveLength(2);
		expect(rule.declarations[0].name).toBe("color");
		expect(rule.declarations[0].important).toBe(false);
		expect(rule.declarations[1].name).toBe("margin");
		expect(rule.declarations[1].important).toBe(true);
	});

	it("should parse @page rules with margin boxes and descriptors", () => {
		const sheet = parseStylesheet(`
			@page :first { size: A4; margin: 1in; @top-center { content: "x"; } }
		`);
		const rule = sheet.rules[0] as AtRule;
		expect(rule.type).toBe("at");
		expect(rule.name).toBe("page");
		expect(serialize(rule.prelude)).toBe(":first");
		expect(rule.declarations?.map(d => d.name)).toEqual(["size", "margin"]);
		expect(rule.rules).toHaveLength(1);
		const box = rule.rules![0] as AtRule;
		expect(box.name).toBe("top-center");
		expect(box.declarations?.[0].name).toBe("content");
	});

	it("should preserve unknown declarations and at-rules", () => {
		const sheet = parseStylesheet(`
			@import url("x.css");
			p { string-set: title content(text); float: footnote; }
			@footnote { border-top: 1px solid; }
		`);
		expect(sheet.rules).toHaveLength(3);
		expect((sheet.rules[0] as AtRule).declarations).toBeUndefined();
		expect(
			(sheet.rules[1] as StyleRule).declarations.map(d => d.name),
		).toEqual(["string-set", "float"]);
		expect((sheet.rules[2] as AtRule).name).toBe("footnote");
	});

	it("should parse nested rules inside @media", () => {
		const sheet = parseStylesheet(
			"@media print { a:hover { color: red } b { c: d } }",
		);
		const media = sheet.rules[0] as AtRule;
		expect(media.rules).toHaveLength(2);
		expect((media.rules![0] as StyleRule).selector).toBe("a:hover");
		expect(media.declarations).toEqual([]);
	});

	it("should recover from stray closing braces", () => {
		const sheet = parseStylesheet("} a { color: red }");
		expect(sheet.rules).toHaveLength(1);
	});

	it("should round-trip through serialization", () => {
		const css = `@page chapter:first { size: 5in 7in; @top-center { content: "Hi" counter(page); } }\np::after { content: leader(".") target-counter(attr(href), page); }`;
		const output = serializeStylesheet(parseStylesheet(css));
		expect(output).toContain("@page chapter:first {");
		expect(output).toContain('content: "Hi" counter(page);');
		expect(output).toContain(
			'leader(".") target-counter(attr(href), page)',
		);
		expect(serializeStylesheet(parseStylesheet(output))).toBe(output);
	});
});

describe("parseComponentValues()", () => {
	it("should parse functions and blocks", () => {
		const values = parseComponentValues(
			"counter(page, lower-roman) [a] (b)",
		);
		expect(values[0]).toMatchObject({ type: "function", name: "counter" });
		expect(values[2]).toMatchObject({ type: "block", open: "[" });
		expect(values[4]).toMatchObject({ type: "block", open: "(" });
	});

	it("should trim surrounding whitespace", () => {
		const values = parseComponentValues("  a  ");
		expect(values).toHaveLength(1);
	});
});

describe("parseDeclarations()", () => {
	it("should parse a declaration list", () => {
		const declarations = parseDeclarations("a: 1; b: 2 !important");
		expect(declarations.map(d => d.name)).toEqual(["a", "b"]);
		expect(declarations[1].important).toBe(true);
	});
});

describe("quoteString()", () => {
	it("should escape quotes, backslashes, and newlines", () => {
		expect(quoteString('a"b\\c\nd')).toBe('"a\\"b\\\\c\\a d"');
	});
});
