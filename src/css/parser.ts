/**
 * @fileoverview CSS parser producing a lightweight rule tree of component
 * values. Unknown rules and declarations are preserved verbatim so that
 * they can be transformed and re-serialized.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { tokenize, type Token, type TokenType } from "./tokenizer.js";

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

export interface FunctionValue {
	type: "function";
	name: string;
	value: ComponentValue[];
}

export interface BlockValue {
	type: "block";
	/** The opening token: "(", "[", or "{". */
	open: "(" | "[" | "{";
	value: ComponentValue[];
}

export type ComponentValue = Token | FunctionValue | BlockValue;

export interface Declaration {
	type: "declaration";
	name: string;
	value: ComponentValue[];
	important: boolean;
}

export interface StyleRule {
	type: "style";
	selector: string;
	declarations: Declaration[];
	rules: Rule[];
}

export interface AtRule {
	type: "at";
	name: string;
	prelude: ComponentValue[];
	/** Undefined for statement at-rules (e.g. `@import`). */
	declarations?: Declaration[];
	rules?: Rule[];
}

export type Rule = StyleRule | AtRule;

export interface Stylesheet {
	rules: Rule[];
}

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

const CLOSERS: Record<string, string> = {
	"(": ")",
	"[": "]",
	"{": "}",
};

/**
 * Determines if a component value is a token of the given type.
 * @param value The component value to check.
 * @param type The token type to check for.
 * @returns True if the value is a matching token.
 */
export function isToken<T extends TokenType>(
	value: ComponentValue | undefined,
	type: T,
): value is Token & { type: T } {
	return !!value && value.type === type;
}

/**
 * Determines if a component value is an ident with the given (case-insensitive) name.
 * @param value The component value to check.
 * @param name The ident name to check for.
 * @returns True if the value is a matching ident.
 */
export function isIdent(
	value: ComponentValue | undefined,
	name?: string,
): value is Token & { type: "ident" } {
	return (
		!!value &&
		value.type === "ident" &&
		(name === undefined || value.value.toLowerCase() === name)
	);
}

/**
 * Determines if a component value is a function with the given (case-insensitive) name.
 * @param value The component value to check.
 * @param name The function name to check for.
 * @returns True if the value is a matching function.
 */
export function isFunction<N extends string = string>(
	value: ComponentValue | undefined,
	name?: N,
): value is FunctionValue & { readonly __fn: N } {
	return (
		!!value &&
		value.type === "function" &&
		(name === undefined || value.name.toLowerCase() === name)
	);
}

/**
 * Removes leading and trailing whitespace tokens.
 * @param values The component values to trim.
 * @returns The trimmed list.
 */
export function trimWhitespace(values: ComponentValue[]): ComponentValue[] {
	let start = 0;
	let end = values.length;

	while (start < end && isToken(values[start], "whitespace")) {
		start++;
	}

	while (end > start && isToken(values[end - 1], "whitespace")) {
		end--;
	}

	return values.slice(start, end);
}

/**
 * Splits component values on comma tokens.
 * @param values The component values to split.
 * @returns The list of comma-separated groups (each trimmed).
 */
export function splitOnCommas(values: ComponentValue[]): ComponentValue[][] {
	const groups: ComponentValue[][] = [];
	let current: ComponentValue[] = [];

	for (const value of values) {
		if (isToken(value, "comma")) {
			groups.push(trimWhitespace(current));
			current = [];
		} else {
			current.push(value);
		}
	}

	groups.push(trimWhitespace(current));
	return groups;
}

/**
 * Removes all whitespace tokens from a list of component values.
 * @param values The component values to filter.
 * @returns The list without whitespace.
 */
export function withoutWhitespace(values: ComponentValue[]): ComponentValue[] {
	return values.filter(value => !isToken(value, "whitespace"));
}

//-----------------------------------------------------------------------------
// Parser
//-----------------------------------------------------------------------------

class Parser {
	#tokens: Token[];
	#pos = 0;

	constructor(tokens: Token[]) {
		this.#tokens = tokens;
	}

	get done(): boolean {
		return this.#pos >= this.#tokens.length;
	}

	#peek(): Token | undefined {
		return this.#tokens[this.#pos];
	}

	#next(): Token | undefined {
		return this.#tokens[this.#pos++];
	}

	#skipWhitespace(): void {
		while (isToken(this.#peek(), "whitespace")) {
			this.#pos++;
		}
	}

	/**
	 * Consumes a component value (a token, function, or block).
	 * @returns The component value.
	 */
	consumeComponentValue(): ComponentValue {
		const token = this.#next()!;

		if (token.type === "{" || token.type === "[" || token.type === "(") {
			return this.#consumeBlock(token.type);
		}

		if (token.type === "function-token") {
			const value: ComponentValue[] = [];

			while (this.#pos < this.#tokens.length) {
				if (this.#peek()!.type === ")") {
					this.#pos++;
					break;
				}

				value.push(this.consumeComponentValue());
			}

			return { type: "function", name: token.value, value };
		}

		return token;
	}

	#consumeBlock(open: "(" | "[" | "{"): BlockValue {
		const closer = CLOSERS[open];
		const value: ComponentValue[] = [];

		while (this.#pos < this.#tokens.length) {
			if (this.#peek()!.type === closer) {
				this.#pos++;
				break;
			}

			value.push(this.consumeComponentValue());
		}

		return { type: "block", open, value };
	}

	/**
	 * Consumes a list of rules until EOF or (when nested) a closing brace.
	 * @param nested Whether this is a nested rule list.
	 * @returns The rules.
	 */
	consumeRuleList(nested: boolean): Rule[] {
		const rules: Rule[] = [];

		while (this.#pos < this.#tokens.length) {
			const token = this.#peek()!;

			if (token.type === "whitespace") {
				this.#pos++;
				continue;
			}

			if (nested && token.type === "}") {
				break;
			}

			if (token.type === "at-keyword") {
				rules.push(this.#consumeAtRule());
				continue;
			}

			const rule = this.#consumeQualifiedRule();

			if (rule) {
				rules.push(rule);
			}
		}

		return rules;
	}

	#consumeAtRule(): AtRule {
		const nameToken = this.#next()!;
		const prelude: ComponentValue[] = [];

		while (this.#pos < this.#tokens.length) {
			const token = this.#peek()!;

			if (token.type === "semicolon") {
				this.#pos++;
				return {
					type: "at",
					name: nameToken.value,
					prelude: trimWhitespace(prelude),
				};
			}

			if (token.type === "}") {
				// unterminated at-rule inside a block
				return {
					type: "at",
					name: nameToken.value,
					prelude: trimWhitespace(prelude),
				};
			}

			if (token.type === "{") {
				this.#pos++;
				const body = this.#consumeBlockContents();
				return {
					type: "at",
					name: nameToken.value,
					prelude: trimWhitespace(prelude),
					declarations: body.declarations,
					rules: body.rules,
				};
			}

			prelude.push(this.consumeComponentValue());
		}

		return {
			type: "at",
			name: nameToken.value,
			prelude: trimWhitespace(prelude),
		};
	}

	#consumeQualifiedRule(): StyleRule | undefined {
		const prelude: ComponentValue[] = [];

		while (this.#pos < this.#tokens.length) {
			const token = this.#peek()!;

			if (token.type === "{") {
				this.#pos++;
				const body = this.#consumeBlockContents();
				return {
					type: "style",
					selector: serialize(trimWhitespace(prelude)),
					declarations: body.declarations,
					rules: body.rules,
				};
			}

			if (token.type === "}") {
				// stray closing brace; discard prelude
				this.#pos++;
				return undefined;
			}

			prelude.push(this.consumeComponentValue());
		}

		return undefined;
	}

	/**
	 * Consumes the contents of a `{}` block, which may contain a mix of
	 * declarations and nested rules. Assumes the opening brace was consumed.
	 * @returns The declarations and rules found.
	 */
	#consumeBlockContents(): { declarations: Declaration[]; rules: Rule[] } {
		const declarations: Declaration[] = [];
		const rules: Rule[] = [];

		while (this.#pos < this.#tokens.length) {
			const token = this.#peek()!;

			if (token.type === "whitespace" || token.type === "semicolon") {
				this.#pos++;
				continue;
			}

			if (token.type === "}") {
				this.#pos++;
				break;
			}

			if (token.type === "at-keyword") {
				rules.push(this.#consumeAtRule());
				continue;
			}

			// Try a declaration: ident followed by colon.
			if (token.type === "ident") {
				const save = this.#pos;
				const declaration = this.#tryConsumeDeclaration();

				if (declaration) {
					declarations.push(declaration);
					continue;
				}

				this.#pos = save;
			}

			const rule = this.#consumeQualifiedRule();

			if (rule) {
				rules.push(rule);
			}
		}

		return { declarations, rules };
	}

	#tryConsumeDeclaration(): Declaration | undefined {
		const nameToken = this.#next()!;
		this.#skipWhitespace();

		if (!isToken(this.#peek(), "colon")) {
			return undefined;
		}

		this.#pos++;

		const value: ComponentValue[] = [];

		while (this.#pos < this.#tokens.length) {
			const token = this.#peek()!;

			if (token.type === "semicolon") {
				this.#pos++;
				break;
			}

			if (token.type === "}") {
				break;
			}

			if (token.type === "{") {
				// This is actually a nested rule whose selector started with
				// an ident and contained a colon (e.g. `a:hover {`).
				return undefined;
			}

			value.push(this.consumeComponentValue());
		}

		let important = false;
		let trimmed = trimWhitespace(value);
		const last = trimmed[trimmed.length - 1];

		if (isIdent(last, "important")) {
			let index = trimmed.length - 2;

			while (index >= 0 && isToken(trimmed[index], "whitespace")) {
				index--;
			}

			const bang = trimmed[index];

			if (index >= 0 && isToken(bang, "delim") && bang.value === "!") {
				important = true;
				trimmed = trimWhitespace(trimmed.slice(0, index));
			}
		}

		return {
			type: "declaration",
			name: nameToken.value.toLowerCase(),
			value: trimmed,
			important,
		};
	}
}

/**
 * Parses a stylesheet.
 * @param text The CSS text.
 * @returns The parsed stylesheet.
 */
export function parseStylesheet(text: string): Stylesheet {
	if (typeof text !== "string") {
		throw new TypeError("Expected a string argument.");
	}

	const parser = new Parser(tokenize(text));
	return { rules: parser.consumeRuleList(false) };
}

/**
 * Parses a list of component values from text (e.g. a property value).
 * @param text The text to parse.
 * @returns The component values.
 */
export function parseComponentValues(text: string): ComponentValue[] {
	if (typeof text !== "string") {
		throw new TypeError("Expected a string argument.");
	}

	const parser = new Parser(tokenize(text));
	const values: ComponentValue[] = [];

	while (!parser.done) {
		values.push(parser.consumeComponentValue());
	}

	return trimWhitespace(values);
}

/**
 * Parses a declaration list (e.g. the contents of a style attribute).
 * @param text The declarations text.
 * @returns The declarations.
 */
export function parseDeclarations(text: string): Declaration[] {
	const sheet = parseStylesheet(`x{${text}}`);
	const rule = sheet.rules[0];
	return rule && rule.type === "style" ? rule.declarations : [];
}

//-----------------------------------------------------------------------------
// Serialization
//-----------------------------------------------------------------------------

/**
 * Escapes a string for inclusion in CSS as a quoted string.
 * @param value The string to escape.
 * @returns The quoted, escaped string.
 */
export function quoteString(value: string): string {
	return `"${value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\a ")}"`;
}

/**
 * Escapes an identifier for inclusion in CSS.
 * @param value The identifier to escape.
 * @returns The escaped identifier.
 */
export function escapeIdent(value: string): string {
	return value.replace(/[^a-zA-Z0-9_\u0080-\uffff-]/g, "\\$&");
}

function serializeToken(token: Token): string {
	switch (token.type) {
		case "ident":
			return escapeIdent(token.value);
		case "function-token":
			return `${escapeIdent(token.value)}(`;
		case "at-keyword":
			return `@${escapeIdent(token.value)}`;
		case "hash":
			return `#${escapeIdent(token.value)}`;
		case "string":
		case "bad-string":
			return quoteString(token.value);
		case "url":
		case "bad-url":
			return `url(${quoteString(token.value)})`;
		case "whitespace":
			return " ";
		default:
			return token.value;
	}
}

/**
 * Serializes component values back into CSS text.
 * @param values The component values.
 * @returns The CSS text.
 */
export function serialize(values: ComponentValue[]): string {
	let result = "";

	for (const value of values) {
		if (value.type === "function") {
			result += `${escapeIdent(value.name)}(${serialize(value.value)})`;
		} else if (value.type === "block") {
			result += `${value.open}${serialize(value.value)}${CLOSERS[value.open]}`;
		} else {
			result += serializeToken(value);
		}
	}

	return result;
}

/**
 * Serializes a declaration.
 * @param declaration The declaration.
 * @returns The CSS text.
 */
export function serializeDeclaration(declaration: Declaration): string {
	return `${declaration.name}: ${serialize(declaration.value)}${declaration.important ? " !important" : ""};`;
}

/**
 * Serializes a rule.
 * @param rule The rule.
 * @returns The CSS text.
 */
export function serializeRule(rule: Rule): string {
	if (rule.type === "style") {
		return `${rule.selector} {${serializeBody(rule.declarations, rule.rules)}}`;
	}

	const prelude = rule.prelude.length ? ` ${serialize(rule.prelude)}` : "";

	if (!rule.declarations && !rule.rules) {
		return `@${escapeIdent(rule.name)}${prelude};`;
	}

	return `@${escapeIdent(rule.name)}${prelude} {${serializeBody(rule.declarations ?? [], rule.rules ?? [])}}`;
}

function serializeBody(declarations: Declaration[], rules: Rule[]): string {
	const parts = [
		...declarations.map(serializeDeclaration),
		...rules.map(serializeRule),
	];
	return parts.length ? `\n${parts.join("\n")}\n` : "";
}

/**
 * Serializes a stylesheet.
 * @param sheet The stylesheet.
 * @returns The CSS text.
 */
export function serializeStylesheet(sheet: Stylesheet): string {
	return sheet.rules.map(serializeRule).join("\n");
}
