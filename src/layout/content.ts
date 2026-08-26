/**
 * @fileoverview Evaluates content lists (from `content`, `string-set`, and
 * margin boxes) into strings or DOM nodes.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import {
	type ContentItem,
	type ContentWhat,
	type StringAssignment,
	type TargetRef,
	formatCounter,
} from "../css/values.js";
import type { CounterValues } from "../counters.js";

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

export interface ContentContext {
	/** The document used to create nodes. */
	document: Document;
	/** Page-level counters (page, pages, footnote, ...). */
	pageCounters: Map<string, number>;
	/** The element the content applies to (body context only). */
	element?: Element;
	/** Resolves a named string for the current page. */
	resolveString?: (
		name: string,
		assignment: StringAssignment,
	) => string | undefined;
	/** Resolves a running element for the current page. */
	resolveElement?: (
		name: string,
		assignment: StringAssignment,
	) => Element | undefined;
	/** Resolves a cross-reference target to an element in the source document. */
	resolveTarget?: (ref: TargetRef, element?: Element) => Element | undefined;
	/** Returns counter values visible at an element. */
	countersOf?: (element: Element) => CounterValues | undefined;
	/** Returns the 1-based page counter value of the page an element is on. */
	pageCounterOf?: (element: Element) => number | undefined;
	/** Quote depth for open-quote/close-quote. */
	quoteDepth?: number;
}

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

const OPEN_QUOTES = ["“", "‘"];
const CLOSE_QUOTES = ["”", "’"];

/**
 * Extracts the string parts of a computed pseudo-element `content` value.
 * @param element The element.
 * @param pseudo The pseudo-element name.
 * @returns The concatenated string parts.
 */
function pseudoText(element: Element, pseudo: string): string {
	const view = element.ownerDocument.defaultView;

	if (!view) {
		return "";
	}

	const content = view.getComputedStyle(element, pseudo).content;

	if (!content || content === "none" || content === "normal") {
		return "";
	}

	const matches =
		content.match(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g) ?? [];
	return matches
		.map(match => match.slice(1, -1).replace(/\\(.)/g, "$1"))
		.join("");
}

/**
 * Returns the text of an element for `content()` and `target-text()`.
 * @param element The element.
 * @param what Which text to return.
 * @returns The text.
 */
export function elementText(element: Element, what: ContentWhat): string {
	switch (what) {
		case "before":
			return pseudoText(element, "::before");
		case "after":
			return pseudoText(element, "::after");
		case "marker":
			return pseudoText(element, "::marker");
		case "first-letter": {
			const text = (element.textContent ?? "").trimStart();
			const match = /^[\p{P}\p{S}]*[\s\S]/u.exec(text);
			return match ? match[0] : "";
		}
		default:
			return (element.textContent ?? "").replace(/\s+/g, " ").trim();
	}
}

function counterText(
	values: CounterValues | undefined,
	name: string,
	style: string,
	separator?: string,
): string {
	const list = values?.get(name) ?? [];

	if (separator === undefined) {
		const value = list.length ? list[list.length - 1] : 0;
		return formatCounter(value, style);
	}

	return list.map(value => formatCounter(value, style)).join(separator);
}

//-----------------------------------------------------------------------------
// Evaluation
//-----------------------------------------------------------------------------

/**
 * Evaluates a single content item to a string.
 * @param item The content item.
 * @param context The evaluation context.
 * @returns The string, or undefined if the item cannot be a string
 *      (e.g. images and running elements).
 */
export function evaluateItemToString(
	item: ContentItem,
	context: ContentContext,
): string | undefined {
	const { element } = context;

	switch (item.type) {
		case "string":
			return item.value;

		case "counter": {
			const pageValue = context.pageCounters.get(item.name);

			if (pageValue !== undefined) {
				return formatCounter(pageValue, item.style);
			}

			if (element && context.countersOf) {
				return counterText(
					context.countersOf(element),
					item.name,
					item.style,
				);
			}

			return formatCounter(0, item.style);
		}

		case "counters": {
			const pageValue = context.pageCounters.get(item.name);

			if (pageValue !== undefined) {
				return formatCounter(pageValue, item.style);
			}

			if (element && context.countersOf) {
				return counterText(
					context.countersOf(element),
					item.name,
					item.style,
					item.separator,
				);
			}

			return "";
		}

		case "attr":
			return element?.getAttribute(item.name) ?? "";

		case "string-ref":
			return context.resolveString?.(item.name, item.assignment) ?? "";

		case "content":
			return element ? elementText(element, item.what) : "";

		case "target-counter": {
			const target = context.resolveTarget?.(item.target, element);

			if (!target) {
				return "";
			}

			if (item.name === "page") {
				const value = context.pageCounterOf?.(target);
				return value === undefined
					? ""
					: formatCounter(value, item.style);
			}

			if (item.name === "pages") {
				return formatCounter(
					context.pageCounters.get("pages") ?? 0,
					item.style,
				);
			}

			return counterText(
				context.countersOf?.(target),
				item.name,
				item.style,
			);
		}

		case "target-counters": {
			const target = context.resolveTarget?.(item.target, element);

			if (!target) {
				return "";
			}

			if (item.name === "page") {
				const value = context.pageCounterOf?.(target);
				return value === undefined
					? ""
					: formatCounter(value, item.style);
			}

			return counterText(
				context.countersOf?.(target),
				item.name,
				item.style,
				item.separator,
			);
		}

		case "target-text": {
			const target = context.resolveTarget?.(item.target, element);
			return target ? elementText(target, item.what) : "";
		}

		case "quote": {
			const depth = context.quoteDepth ?? 0;

			switch (item.which) {
				case "open-quote":
					return OPEN_QUOTES[Math.min(depth, OPEN_QUOTES.length - 1)];
				case "close-quote":
					return CLOSE_QUOTES[
						Math.min(
							Math.max(depth - 1, 0),
							CLOSE_QUOTES.length - 1,
						)
					];
				default:
					return "";
			}
		}

		case "leader":
			return undefined;

		case "url":
		case "element":
		case "raw":
			return undefined;

		default:
			return undefined;
	}
}

/**
 * Evaluates a content list to a plain string, ignoring items that cannot be
 * represented as text.
 * @param items The content items.
 * @param context The evaluation context.
 * @returns The string.
 */
export function evaluateToString(
	items: ContentItem[],
	context: ContentContext,
): string {
	let result = "";

	for (const item of items) {
		result += evaluateItemToString(item, context) ?? "";
	}

	return result;
}

/**
 * Evaluates a content list to DOM nodes.
 * @param items The content items.
 * @param context The evaluation context.
 * @returns The nodes.
 */
export function evaluateToNodes(
	items: ContentItem[],
	context: ContentContext,
): Node[] {
	const nodes: Node[] = [];
	const doc = context.document;
	let text = "";

	function flush(): void {
		if (text) {
			nodes.push(doc.createTextNode(text));
			text = "";
		}
	}

	for (const item of items) {
		if (item.type === "url") {
			flush();
			const img = doc.createElement("img");
			img.src = item.url;
			nodes.push(img);
			continue;
		}

		if (item.type === "element") {
			flush();
			const found = context.resolveElement?.(item.name, item.assignment);

			if (found) {
				const clone = found.cloneNode(true) as Element;
				clone.setAttribute("data-pm-running", item.name);
				nodes.push(clone);
			}

			continue;
		}

		if (item.type === "leader") {
			flush();
			const span = doc.createElement("span");
			span.className = "pm-leader";
			span.setAttribute("data-pm-pattern", item.pattern);
			nodes.push(span);
			continue;
		}

		text += evaluateItemToString(item, context) ?? "";
	}

	flush();
	return nodes;
}
