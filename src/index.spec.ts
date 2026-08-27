/**
 * @fileoverview Tests for the polyfill entry point helpers.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { absolutizeUrls } from "./index.js";

//-----------------------------------------------------------------------------
// Tests
//-----------------------------------------------------------------------------

describe("absolutizeUrls()", () => {
	const base = "https://example.com/css/print/book.css";

	it("should resolve relative urls against the stylesheet", () => {
		expect(
			absolutizeUrls(
				`@font-face { src: url("fonts/a.ttf"); } .b { background: url(../img/b.png) } .c { background: url( 'c.png' ) }`,
				base,
			),
		).toBe(
			`@font-face { src: url("https://example.com/css/print/fonts/a.ttf"); } .b { background: url("https://example.com/css/img/b.png") } .c { background: url("https://example.com/css/print/c.png") }`,
		);
	});

	it("should leave absolute, data, fragment, and empty urls alone", () => {
		const css = `a { background: url(data:image/png;base64,AAAA) } b { background: url("https://cdn.example.com/x.png") } c { mask: url(#m) } d { background: url() } e { background: url(//cdn.example.com/y.png) }`;
		expect(absolutizeUrls(css, base)).toBe(css);
	});
});
