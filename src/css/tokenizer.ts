/**
 * @fileoverview CSS tokenizer implementing the relevant parts of CSS Syntax
 * Module Level 3. It is used because the browser's CSSOM discards any
 * declarations, descriptors, and rules it doesn't understand, which is exactly
 * what a polyfill needs to see.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

export type TokenType =
	| "ident"
	| "function-token"
	| "at-keyword"
	| "hash"
	| "string"
	| "bad-string"
	| "url"
	| "bad-url"
	| "delim"
	| "number"
	| "percentage"
	| "dimension"
	| "whitespace"
	| "colon"
	| "semicolon"
	| "comma"
	| "["
	| "]"
	| "("
	| ")"
	| "{"
	| "}"
	| "EOF";

export interface Token {
	type: TokenType;
	/** The raw text or the parsed value (for strings and idents). */
	value: string;
	/** Numeric value for number, percentage, and dimension tokens. */
	number?: number;
	/** Unit for dimension tokens. */
	unit?: string;
	/** Start offset in the input. */
	start: number;
	/** End offset in the input. */
	end: number;
}

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

function isDigit(c: string): boolean {
	return c >= "0" && c <= "9";
}

function isHexDigit(c: string): boolean {
	return isDigit(c) || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");
}

function isNameStart(c: string): boolean {
	return (
		(c >= "a" && c <= "z") ||
		(c >= "A" && c <= "Z") ||
		c === "_" ||
		c.charCodeAt(0) >= 0x80
	);
}

function isName(c: string): boolean {
	return isNameStart(c) || isDigit(c) || c === "-";
}

function isWhitespace(c: string): boolean {
	return c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";
}

function isNewline(c: string): boolean {
	return c === "\n" || c === "\r" || c === "\f";
}

//-----------------------------------------------------------------------------
// Tokenizer
//-----------------------------------------------------------------------------

/**
 * Tokenizes a CSS string.
 * @param text The CSS text to tokenize.
 * @returns The list of tokens (not including EOF).
 */
export function tokenize(text: string): Token[] {
	if (typeof text !== "string") {
		throw new TypeError("Expected a string argument.");
	}

	const tokens: Token[] = [];
	const length = text.length;
	let pos = 0;

	function peek(offset = 0): string {
		return pos + offset < length ? text[pos + offset] : "";
	}

	function push(
		type: TokenType,
		value: string,
		start: number,
		extra?: Partial<Token>,
	): void {
		tokens.push({ type, value, start, end: pos, ...extra });
	}

	function isValidEscape(c: string, next: string): boolean {
		return c === "\\" && next !== "" && !isNewline(next);
	}

	function startsIdent(offset = 0): boolean {
		const c = peek(offset);

		if (c === "-") {
			const next = peek(offset + 1);
			return (
				isNameStart(next) ||
				next === "-" ||
				isValidEscape(next, peek(offset + 2))
			);
		}

		if (isNameStart(c)) {
			return true;
		}

		return isValidEscape(c, peek(offset + 1));
	}

	function startsNumber(offset = 0): boolean {
		const c = peek(offset);

		if (c === "+" || c === "-") {
			const next = peek(offset + 1);
			return isDigit(next) || (next === "." && isDigit(peek(offset + 2)));
		}

		if (c === ".") {
			return isDigit(peek(offset + 1));
		}

		return isDigit(c);
	}

	function consumeEscape(): string {
		// assumes the backslash has been consumed
		const c = peek();

		if (isHexDigit(c)) {
			let hex = "";

			while (hex.length < 6 && isHexDigit(peek())) {
				hex += peek();
				pos++;
			}

			if (isWhitespace(peek())) {
				pos++;
			}

			const codePoint = parseInt(hex, 16);

			if (
				codePoint === 0 ||
				codePoint > 0x10ffff ||
				(codePoint >= 0xd800 && codePoint <= 0xdfff)
			) {
				return "�";
			}

			return String.fromCodePoint(codePoint);
		}

		if (c === "") {
			return "�";
		}

		pos++;
		return c;
	}

	function consumeName(): string {
		let result = "";

		while (pos < length) {
			const c = peek();

			if (isName(c)) {
				result += c;
				pos++;
			} else if (isValidEscape(c, peek(1))) {
				pos++;
				result += consumeEscape();
			} else {
				break;
			}
		}

		return result;
	}

	function consumeNumber(): { repr: string; value: number } {
		let repr = "";

		if (peek() === "+" || peek() === "-") {
			repr += peek();
			pos++;
		}

		while (isDigit(peek())) {
			repr += peek();
			pos++;
		}

		if (peek() === "." && isDigit(peek(1))) {
			repr += peek() + peek(1);
			pos += 2;

			while (isDigit(peek())) {
				repr += peek();
				pos++;
			}
		}

		if (
			(peek() === "e" || peek() === "E") &&
			(isDigit(peek(1)) ||
				((peek(1) === "+" || peek(1) === "-") && isDigit(peek(2))))
		) {
			repr += peek();
			pos++;

			if (peek() === "+" || peek() === "-") {
				repr += peek();
				pos++;
			}

			while (isDigit(peek())) {
				repr += peek();
				pos++;
			}
		}

		return { repr, value: Number(repr) };
	}

	function consumeString(quote: string, start: number): void {
		let value = "";
		pos++;

		while (pos < length) {
			const c = peek();

			if (c === quote) {
				pos++;
				push("string", value, start);
				return;
			}

			if (isNewline(c)) {
				push("bad-string", value, start);
				return;
			}

			if (c === "\\") {
				pos++;

				if (pos >= length) {
					break;
				}

				if (isNewline(peek())) {
					pos++;
					continue;
				}

				value += consumeEscape();
				continue;
			}

			value += c;
			pos++;
		}

		push("string", value, start);
	}

	function consumeUrl(start: number): void {
		// assumes "url(" has been consumed
		let value = "";

		while (isWhitespace(peek())) {
			pos++;
		}

		while (pos < length) {
			const c = peek();

			if (c === ")") {
				pos++;
				push("url", value, start);
				return;
			}

			if (isWhitespace(c)) {
				while (isWhitespace(peek())) {
					pos++;
				}

				if (peek() === ")" || peek() === "") {
					pos++;
					push("url", value, start);
					return;
				}

				consumeBadUrl();
				push("bad-url", value, start);
				return;
			}

			if (c === '"' || c === "'" || c === "(") {
				consumeBadUrl();
				push("bad-url", value, start);
				return;
			}

			if (c === "\\") {
				if (isValidEscape(c, peek(1))) {
					pos++;
					value += consumeEscape();
					continue;
				}

				consumeBadUrl();
				push("bad-url", value, start);
				return;
			}

			value += c;
			pos++;
		}

		push("url", value, start);
	}

	function consumeBadUrl(): void {
		while (pos < length) {
			const c = peek();

			if (c === ")") {
				pos++;
				return;
			}

			if (isValidEscape(c, peek(1))) {
				pos++;
				consumeEscape();
				continue;
			}

			pos++;
		}
	}

	while (pos < length) {
		const start = pos;
		const c = peek();

		// comments
		if (c === "/" && peek(1) === "*") {
			const endIndex = text.indexOf("*/", pos + 2);
			pos = endIndex === -1 ? length : endIndex + 2;
			continue;
		}

		if (isWhitespace(c)) {
			while (isWhitespace(peek())) {
				pos++;
			}

			push("whitespace", " ", start);
			continue;
		}

		if (c === '"' || c === "'") {
			consumeString(c, start);
			continue;
		}

		if (c === "#") {
			if (isName(peek(1)) || isValidEscape(peek(1), peek(2))) {
				pos++;
				push("hash", consumeName(), start);
				continue;
			}

			pos++;
			push("delim", c, start);
			continue;
		}

		if (
			c === "(" ||
			c === ")" ||
			c === "[" ||
			c === "]" ||
			c === "{" ||
			c === "}"
		) {
			pos++;
			push(c as TokenType, c, start);
			continue;
		}

		if (c === ",") {
			pos++;
			push("comma", c, start);
			continue;
		}

		if (c === ":") {
			pos++;
			push("colon", c, start);
			continue;
		}

		if (c === ";") {
			pos++;
			push("semicolon", c, start);
			continue;
		}

		if (c === "<" && text.startsWith("<!--", pos)) {
			pos += 4;
			continue;
		}

		if (c === "-" && text.startsWith("-->", pos)) {
			pos += 3;
			continue;
		}

		if (c === "@") {
			if (startsIdent(1)) {
				pos++;
				push("at-keyword", consumeName(), start);
				continue;
			}

			pos++;
			push("delim", c, start);
			continue;
		}

		if (startsNumber()) {
			const { repr, value } = consumeNumber();

			if (startsIdent()) {
				const unit = consumeName();
				push("dimension", repr + unit, start, { number: value, unit });
				continue;
			}

			if (peek() === "%") {
				pos++;
				push("percentage", repr + "%", start, { number: value });
				continue;
			}

			push("number", repr, start, { number: value });
			continue;
		}

		if (startsIdent()) {
			const name = consumeName();

			if (peek() === "(") {
				pos++;

				if (name.toLowerCase() === "url") {
					let lookahead = pos;

					while (isWhitespace(text[lookahead] ?? "")) {
						lookahead++;
					}

					const q = text[lookahead];

					if (q !== '"' && q !== "'") {
						consumeUrl(start);
						continue;
					}
				}

				push("function-token", name, start);
				continue;
			}

			push("ident", name, start);
			continue;
		}

		pos++;
		push("delim", c, start);
	}

	return tokens;
}
