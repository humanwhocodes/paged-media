/**
 * @fileoverview Parsers for paged media value types: page selectors,
 * lengths, page sizes, content lists, and counter styles.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import {
	type ComponentValue,
	isFunction,
	isIdent,
	isToken,
	serialize,
	splitOnCommas,
	withoutWhitespace,
} from "./parser.js";
import type { Token } from "./tokenizer.js";

//-----------------------------------------------------------------------------
// Page Selectors
//-----------------------------------------------------------------------------

export interface NthSelector {
	a: number;
	b: number;
}

export type Specificity = [number, number, number];

export interface PageSelector {
	/** The page name, if any. */
	name?: string;
	first: boolean;
	blank: boolean;
	left: boolean;
	right: boolean;
	nth: NthSelector[];
	/** Specificity as (f, g, h) per CSS Paged Media Level 3. */
	specificity: Specificity;
}

/**
 * Parses an An+B expression (as used by :nth()).
 * @param text The expression text.
 * @returns The parsed expression or undefined if invalid.
 */
export function parseNth(text: string): NthSelector | undefined {
	const normalized = text.replace(/\s+/g, "").toLowerCase();

	if (normalized === "even") {
		return { a: 2, b: 0 };
	}

	if (normalized === "odd") {
		return { a: 2, b: 1 };
	}

	const match = /^(?:([+-]?\d*)n)?([+-]?\d+)?$/.exec(normalized);

	if (!match || normalized === "") {
		return undefined;
	}

	let a = 0;

	if (match[1] !== undefined) {
		if (match[1] === "" || match[1] === "+") {
			a = 1;
		} else if (match[1] === "-") {
			a = -1;
		} else {
			a = Number(match[1]);
		}
	}

	const b = match[2] !== undefined ? Number(match[2]) : 0;

	if (Number.isNaN(a) || Number.isNaN(b)) {
		return undefined;
	}

	return { a, b };
}

/**
 * Determines if an index matches an An+B expression.
 * @param nth The expression.
 * @param index The 1-based index.
 * @returns True if the index matches.
 */
export function matchesNth(nth: NthSelector, index: number): boolean {
	if (nth.a === 0) {
		return index === nth.b;
	}

	const n = (index - nth.b) / nth.a;
	return Number.isInteger(n) && n >= 0;
}

/**
 * Parses the prelude of an @page rule into a list of page selectors.
 * @param prelude The prelude component values.
 * @returns The list of selectors (an empty prelude yields one universal
 *      selector), or undefined if the prelude is invalid.
 */
export function parsePageSelectors(
	prelude: ComponentValue[],
): PageSelector[] | undefined {
	const groups = prelude.length ? splitOnCommas(prelude) : [[]];
	const selectors: PageSelector[] = [];

	for (const group of groups) {
		const selector = parsePageSelector(group);

		if (!selector) {
			return undefined;
		}

		selectors.push(selector);
	}

	return selectors;
}

function parsePageSelector(values: ComponentValue[]): PageSelector | undefined {
	const selector: PageSelector = {
		first: false,
		blank: false,
		left: false,
		right: false,
		nth: [],
		specificity: [0, 0, 0],
	};

	let index = 0;
	const firstValue = values[index];

	if (isIdent(firstValue)) {
		selector.name = firstValue.value;
		selector.specificity[0] = 1;
		index++;
	}

	while (index < values.length) {
		if (!isToken(values[index], "colon")) {
			return undefined;
		}

		index++;
		const value = values[index];
		index++;

		if (isIdent(value)) {
			switch (value.value.toLowerCase()) {
				case "first":
					selector.first = true;
					selector.specificity[1]++;
					break;
				case "blank":
					selector.blank = true;
					selector.specificity[1]++;
					break;
				case "left":
				case "verso":
					selector.left = true;
					selector.specificity[2]++;
					break;
				case "right":
				case "recto":
					selector.right = true;
					selector.specificity[2]++;
					break;
				default:
					return undefined;
			}
		} else if (isFunction(value, "nth")) {
			const nth = parseNth(serialize(value.value));

			if (!nth) {
				return undefined;
			}

			selector.nth.push(nth);
			selector.specificity[1]++;
		} else {
			return undefined;
		}
	}

	return selector;
}

/**
 * Compares two specificities.
 * @param a The first specificity.
 * @param b The second specificity.
 * @returns Negative if a < b, positive if a > b, zero if equal.
 */
export function compareSpecificity(a: Specificity, b: Specificity): number {
	return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

//-----------------------------------------------------------------------------
// Lengths
//-----------------------------------------------------------------------------

const UNITS_PER_PX: Record<string, number> = {
	px: 1,
	in: 96,
	cm: 96 / 2.54,
	mm: 96 / 25.4,
	q: 96 / 25.4 / 4,
	pt: 96 / 72,
	pc: 16,
};

/**
 * Converts an absolute length to pixels.
 * @param value The numeric value.
 * @param unit The unit.
 * @param fontSize The font size used for em/rem units.
 * @returns The pixel value or undefined if the unit is unsupported.
 */
export function toPixels(
	value: number,
	unit: string,
	fontSize = 16,
): number | undefined {
	const lower = unit.toLowerCase();

	if (lower in UNITS_PER_PX) {
		return value * UNITS_PER_PX[lower];
	}

	if (lower === "em" || lower === "rem") {
		return value * fontSize;
	}

	return undefined;
}

/**
 * Parses a single length component value into pixels.
 * @param value The component value.
 * @param fontSize The font size used for em units.
 * @returns The pixel value or undefined.
 */
export function parseLength(
	value: ComponentValue | undefined,
	fontSize = 16,
): number | undefined {
	if (!value) {
		return undefined;
	}

	if (isToken(value, "dimension")) {
		return toPixels(value.number!, value.unit!, fontSize);
	}

	if (isToken(value, "number") && value.number === 0) {
		return 0;
	}

	return undefined;
}

//-----------------------------------------------------------------------------
// Page Sizes
//-----------------------------------------------------------------------------

export interface PageSize {
	width: number;
	height: number;
}

const PAGE_SIZES: Record<string, PageSize> = {
	a5: { width: 148 * UNITS_PER_PX.mm, height: 210 * UNITS_PER_PX.mm },
	a4: { width: 210 * UNITS_PER_PX.mm, height: 297 * UNITS_PER_PX.mm },
	a3: { width: 297 * UNITS_PER_PX.mm, height: 420 * UNITS_PER_PX.mm },
	b5: { width: 176 * UNITS_PER_PX.mm, height: 250 * UNITS_PER_PX.mm },
	b4: { width: 250 * UNITS_PER_PX.mm, height: 353 * UNITS_PER_PX.mm },
	"jis-b5": { width: 182 * UNITS_PER_PX.mm, height: 257 * UNITS_PER_PX.mm },
	"jis-b4": { width: 257 * UNITS_PER_PX.mm, height: 364 * UNITS_PER_PX.mm },
	letter: { width: 8.5 * 96, height: 11 * 96 },
	legal: { width: 8.5 * 96, height: 14 * 96 },
	ledger: { width: 11 * 96, height: 17 * 96 },
};

/**
 * Parses a `size` descriptor value.
 * @param values The component values.
 * @param defaultSize The size used for `auto`.
 * @param fontSize The font size for em units.
 * @returns The page size, or undefined if invalid.
 */
export function parsePageSize(
	values: ComponentValue[],
	defaultSize: PageSize,
	fontSize = 16,
): PageSize | undefined {
	const parts = withoutWhitespace(values);

	if (parts.length === 0 || parts.length > 2) {
		return undefined;
	}

	let size: PageSize | undefined;
	let orientation: "portrait" | "landscape" | undefined;
	const lengths: number[] = [];

	for (const part of parts) {
		if (isIdent(part)) {
			const name = part.value.toLowerCase();

			if (name === "auto") {
				size = { ...defaultSize };
			} else if (name === "portrait" || name === "landscape") {
				if (orientation) {
					return undefined;
				}

				orientation = name;
			} else if (name in PAGE_SIZES) {
				if (size) {
					return undefined;
				}

				size = { ...PAGE_SIZES[name] };
			} else {
				return undefined;
			}
		} else {
			const length = parseLength(part, fontSize);

			if (length === undefined) {
				return undefined;
			}

			lengths.push(length);
		}
	}

	if (lengths.length) {
		if (size || orientation) {
			return undefined;
		}

		return {
			width: lengths[0],
			height: lengths.length === 2 ? lengths[1] : lengths[0],
		};
	}

	if (!size) {
		size = { ...defaultSize };
	}

	if (orientation === "landscape" && size.width < size.height) {
		size = { width: size.height, height: size.width };
	} else if (orientation === "portrait" && size.width > size.height) {
		size = { width: size.height, height: size.width };
	}

	return size;
}

//-----------------------------------------------------------------------------
// Content Lists
//-----------------------------------------------------------------------------

export type StringAssignment = "first" | "start" | "last" | "first-except";

export type ContentWhat =
	"text" | "before" | "after" | "first-letter" | "marker";

export type TargetRef =
	{ type: "attr"; name: string } | { type: "url"; url: string };

export type ContentItem =
	| { type: "string"; value: string }
	| { type: "counter"; name: string; style: string }
	| { type: "counters"; name: string; separator: string; style: string }
	| { type: "attr"; name: string }
	| { type: "url"; url: string }
	| { type: "string-ref"; name: string; assignment: StringAssignment }
	| { type: "element"; name: string; assignment: StringAssignment }
	| { type: "content"; what: ContentWhat }
	| { type: "target-counter"; target: TargetRef; name: string; style: string }
	| {
			type: "target-counters";
			target: TargetRef;
			name: string;
			separator: string;
			style: string;
	  }
	| { type: "target-text"; target: TargetRef; what: ContentWhat }
	| { type: "leader"; pattern: string }
	| {
			type: "quote";
			which:
				| "open-quote"
				| "close-quote"
				| "no-open-quote"
				| "no-close-quote";
	  }
	| { type: "raw"; css: string };

export type ContentValue =
	| { type: "none" }
	| { type: "normal" }
	| { type: "list"; items: ContentItem[] };

const STRING_ASSIGNMENTS = new Set(["first", "start", "last", "first-except"]);
const CONTENT_WHATS = new Set([
	"text",
	"before",
	"after",
	"first-letter",
	"marker",
]);

function identValue(value: ComponentValue | undefined): string | undefined {
	return isIdent(value) ? value.value : undefined;
}

function parseTargetRef(
	value: ComponentValue | undefined,
): TargetRef | undefined {
	if (!value) {
		return undefined;
	}

	if (isToken(value, "string") || isToken(value, "url")) {
		return { type: "url", url: value.value };
	}

	if (isFunction(value, "url")) {
		const inner = withoutWhitespace(value.value)[0];

		if (isToken(inner, "string")) {
			return { type: "url", url: inner.value };
		}

		return undefined;
	}

	if (isFunction(value, "attr")) {
		const inner = withoutWhitespace(value.value)[0];

		if (isIdent(inner)) {
			return { type: "attr", name: inner.value };
		}
	}

	return undefined;
}

function parseAssignment(
	value: ComponentValue | undefined,
): StringAssignment | undefined {
	const assignment = (identValue(value) ?? "first").toLowerCase();
	return STRING_ASSIGNMENTS.has(assignment)
		? (assignment as StringAssignment)
		: undefined;
}

/**
 * Parses a single content item.
 * @param value The component value.
 * @returns The content item, or undefined if unsupported.
 */
export function parseContentItem(
	value: ComponentValue,
): ContentItem | undefined {
	if (isToken(value, "string")) {
		return { type: "string", value: value.value };
	}

	if (isToken(value, "url")) {
		return { type: "url", url: value.value };
	}

	if (isIdent(value)) {
		const name = value.value.toLowerCase();

		if (
			name === "open-quote" ||
			name === "close-quote" ||
			name === "no-open-quote" ||
			name === "no-close-quote"
		) {
			return { type: "quote", which: name };
		}

		return undefined;
	}

	if (value.type !== "function") {
		return undefined;
	}

	const name = value.name.toLowerCase();
	const args = splitOnCommas(value.value).map(withoutWhitespace);
	const first = args[0] ?? [];

	switch (name) {
		case "counter": {
			const counterName = identValue(first[0]);

			if (!counterName) {
				return undefined;
			}

			return {
				type: "counter",
				name: counterName,
				style: identValue(args[1]?.[0]) ?? "decimal",
			};
		}

		case "counters": {
			const counterName = identValue(first[0]);
			const separator = args[1]?.[0];

			if (!counterName || !isToken(separator, "string")) {
				return undefined;
			}

			return {
				type: "counters",
				name: counterName,
				separator: separator.value,
				style: identValue(args[2]?.[0]) ?? "decimal",
			};
		}

		case "attr": {
			const attrName = identValue(first[0]);

			if (!attrName) {
				return undefined;
			}

			return { type: "attr", name: attrName };
		}

		case "url": {
			const inner = first[0];

			if (isToken(inner, "string")) {
				return { type: "url", url: inner.value };
			}

			return undefined;
		}

		case "string": {
			const stringName = identValue(first[0]);
			const assignment = parseAssignment(args[1]?.[0]);

			if (!stringName || !assignment) {
				return undefined;
			}

			return { type: "string-ref", name: stringName, assignment };
		}

		case "element": {
			const elementName = identValue(first[0]);
			const assignment = parseAssignment(args[1]?.[0]);

			if (!elementName || !assignment) {
				return undefined;
			}

			return { type: "element", name: elementName, assignment };
		}

		case "content": {
			const what = (identValue(first[0]) ?? "text").toLowerCase();

			if (!CONTENT_WHATS.has(what)) {
				return undefined;
			}

			return { type: "content", what: what as ContentWhat };
		}

		case "target-counter": {
			const target = parseTargetRef(first[0]);
			const counterName = identValue(args[1]?.[0]);

			if (!target || !counterName) {
				return undefined;
			}

			return {
				type: "target-counter",
				target,
				name: counterName,
				style: identValue(args[2]?.[0]) ?? "decimal",
			};
		}

		case "target-counters": {
			const target = parseTargetRef(first[0]);
			const counterName = identValue(args[1]?.[0]);
			const separator = args[2]?.[0];

			if (!target || !counterName || !isToken(separator, "string")) {
				return undefined;
			}

			return {
				type: "target-counters",
				target,
				name: counterName,
				separator: separator.value,
				style: identValue(args[3]?.[0]) ?? "decimal",
			};
		}

		case "target-text": {
			const target = parseTargetRef(first[0]);

			if (!target) {
				return undefined;
			}

			let what = (identValue(args[1]?.[0]) ?? "text").toLowerCase();

			if (what === "content") {
				what = "text";
			}

			if (!CONTENT_WHATS.has(what) || what === "marker") {
				return undefined;
			}

			return { type: "target-text", target, what: what as ContentWhat };
		}

		case "leader": {
			const arg = first[0];

			if (isToken(arg, "string")) {
				return { type: "leader", pattern: arg.value };
			}

			switch (identValue(arg)?.toLowerCase()) {
				case "dotted":
					return { type: "leader", pattern: "." };
				case "solid":
					return { type: "leader", pattern: "_" };
				case "space":
					return { type: "leader", pattern: " " };
				default:
					return undefined;
			}
		}

		default:
			return undefined;
	}
}

/**
 * Parses a `content` property value.
 * @param values The component values.
 * @returns The content value, or undefined if invalid.
 */
export function parseContent(
	values: ComponentValue[],
): ContentValue | undefined {
	const parts = withoutWhitespace(values);

	if (parts.length === 0) {
		return undefined;
	}

	if (parts.length === 1 && isIdent(parts[0], "none")) {
		return { type: "none" };
	}

	if (parts.length === 1 && isIdent(parts[0], "normal")) {
		return { type: "normal" };
	}

	const items: ContentItem[] = [];

	for (const part of parts) {
		// Stop at the alt text separator ("/"), which we do not render.
		if (isToken(part, "delim") && part.value === "/") {
			break;
		}

		const item = parseContentItem(part);

		if (!item) {
			// Preserve unknown values (e.g. image-set(), gradients) verbatim
			// so they can be passed through to the browser.
			items.push({ type: "raw", css: serialize([part]) });
			continue;
		}

		items.push(item);
	}

	return { type: "list", items };
}

/**
 * Determines whether a content value contains any item that must be
 * evaluated by the polyfill rather than the browser.
 * @param content The content value.
 * @returns True if the polyfill must evaluate the content.
 */
export function isDynamicContent(content: ContentValue): boolean {
	if (content.type !== "list") {
		return false;
	}

	return content.items.some(item => {
		switch (item.type) {
			case "string-ref":
			case "element":
			case "target-counter":
			case "target-counters":
			case "target-text":
			case "leader":
			case "content":
				return true;
			case "counter":
			case "counters":
				return (
					item.name === "page" ||
					item.name === "pages" ||
					item.name === "footnote"
				);
			default:
				return false;
		}
	});
}

//-----------------------------------------------------------------------------
// string-set
//-----------------------------------------------------------------------------

export interface StringSetEntry {
	name: string;
	items: ContentItem[];
}

/**
 * Parses a `string-set` property value.
 * @param values The component values.
 * @returns The list of entries (empty for `none`), or undefined if invalid.
 */
export function parseStringSet(
	values: ComponentValue[],
): StringSetEntry[] | undefined {
	const parts = withoutWhitespace(values);

	if (parts.length === 1 && isIdent(parts[0], "none")) {
		return [];
	}

	const entries: StringSetEntry[] = [];

	for (const group of splitOnCommas(values)) {
		const groupParts = withoutWhitespace(group);
		const name = identValue(groupParts[0]);

		if (!name) {
			return undefined;
		}

		const items: ContentItem[] = [];

		for (const part of groupParts.slice(1)) {
			const item = parseContentItem(part);

			if (!item) {
				return undefined;
			}

			items.push(item);
		}

		if (items.length === 0) {
			items.push({ type: "content", what: "text" });
		}

		entries.push({ name, items });
	}

	return entries;
}

//-----------------------------------------------------------------------------
// Counter Styles
//-----------------------------------------------------------------------------

function toRoman(value: number): string {
	if (value <= 0 || value >= 4000) {
		return String(value);
	}

	const numerals: [number, string][] = [
		[1000, "m"],
		[900, "cm"],
		[500, "d"],
		[400, "cd"],
		[100, "c"],
		[90, "xc"],
		[50, "l"],
		[40, "xl"],
		[10, "x"],
		[9, "ix"],
		[5, "v"],
		[4, "iv"],
		[1, "i"],
	];

	let result = "";
	let remaining = value;

	for (const [amount, numeral] of numerals) {
		while (remaining >= amount) {
			result += numeral;
			remaining -= amount;
		}
	}

	return result;
}

function toAlpha(value: number, alphabet: string): string {
	if (value <= 0) {
		return String(value);
	}

	const letters = [...alphabet];
	let result = "";
	let remaining = value;

	while (remaining > 0) {
		remaining--;
		result = letters[remaining % letters.length] + result;
		remaining = Math.floor(remaining / letters.length);
	}

	return result;
}

/**
 * Formats a counter value using a counter style.
 * @param value The counter value.
 * @param style The counter style name.
 * @returns The formatted value.
 */
export function formatCounter(value: number, style = "decimal"): string {
	switch (style.toLowerCase()) {
		case "none":
			return "";
		case "decimal-leading-zero":
			return value < 10 && value >= 0 ? `0${value}` : String(value);
		case "lower-roman":
			return toRoman(value);
		case "upper-roman":
			return toRoman(value).toUpperCase();
		case "lower-alpha":
		case "lower-latin":
			return toAlpha(value, "abcdefghijklmnopqrstuvwxyz");
		case "upper-alpha":
		case "upper-latin":
			return toAlpha(value, "ABCDEFGHIJKLMNOPQRSTUVWXYZ");
		case "lower-greek":
			return toAlpha(value, "αβγδεζηθικλμνξοπρστυφχψω");
		case "disc":
			return "•";
		case "circle":
			return "◦";
		case "square":
			return "▪";
		default:
			return String(value);
	}
}

/**
 * Determines if a token is a specific token type. Re-exported for
 * convenience of other modules.
 * @param value The value to check.
 * @returns True if the value is a token.
 */
export function isTokenValue(value: ComponentValue): value is Token {
	return value.type !== "function" && value.type !== "block";
}
