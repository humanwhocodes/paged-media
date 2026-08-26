/**
 * @fileoverview Applies dynamic generated content (page counters, named
 * strings, cross references, and leaders) to paginated content.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { quoteString } from "../css/parser.js";
import type { ContentItem, TargetRef } from "../css/values.js";
import { CUSTOM_PROPERTIES, type DynamicContentRule } from "../transform.js";
import {
	type ContentContext,
	evaluateItemToString,
	evaluateToString,
} from "./content.js";

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

export interface DynamicContentOptions {
	rules: DynamicContentRule[];
	/** The container holding the pages. */
	container: Element;
	/** Creates an evaluation context for an element in the pages. */
	contextFor: (element: Element) => ContentContext;
}

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

const LEADER_REPEAT = 400;

/**
 * Resolves a cross-reference target URL to an element id.
 * @param ref The target reference.
 * @param element The element the reference is on (for attr()).
 * @param baseURL The document URL.
 * @returns The id, or undefined if the reference is not a same-document fragment.
 */
export function targetId(
	ref: TargetRef,
	element: Element | undefined,
	baseURL: string,
): string | undefined {
	const raw = ref.type === "attr" ? element?.getAttribute(ref.name) : ref.url;

	if (!raw) {
		return undefined;
	}

	const hashIndex = raw.indexOf("#");

	if (hashIndex === -1) {
		return undefined;
	}

	const beforeHash = raw.slice(0, hashIndex);

	if (beforeHash) {
		try {
			const resolved = new URL(beforeHash, baseURL);
			const base = new URL(baseURL);

			if (resolved.href.split("#")[0] !== base.href.split("#")[0]) {
				return undefined;
			}
		} catch {
			return undefined;
		}
	}

	try {
		return decodeURIComponent(raw.slice(hashIndex + 1));
	} catch {
		return raw.slice(hashIndex + 1);
	}
}

/**
 * Builds the CSS value for a `content` custom property from content items.
 * @param items The content items.
 * @param context The evaluation context.
 * @returns The CSS value text.
 */
function contentToCSS(items: ContentItem[], context: ContentContext): string {
	const parts: string[] = [];
	let text = "";

	function flush(): void {
		if (text) {
			parts.push(quoteString(text));
			text = "";
		}
	}

	for (const item of items) {
		if (item.type === "raw") {
			flush();
			parts.push(item.css);
			continue;
		}

		if (item.type === "url") {
			flush();
			parts.push(`url(${quoteString(item.url)})`);
			continue;
		}

		if (item.type === "leader") {
			text += item.pattern.repeat(
				Math.max(1, Math.ceil(LEADER_REPEAT / item.pattern.length)),
			);
			continue;
		}

		if (item.type === "element") {
			continue;
		}

		text += evaluateItemToString(item, context) ?? "";
	}

	flush();
	return parts.length ? parts.join(" ") : '""';
}

function queryAll(container: Element, selector: string): Element[] {
	try {
		return [...container.querySelectorAll(selector)];
	} catch {
		return [];
	}
}

//-----------------------------------------------------------------------------
// Application
//-----------------------------------------------------------------------------

/**
 * Applies dynamic content rules to the paginated content.
 * @param options The options.
 */
export function applyDynamicContent(options: DynamicContentOptions): void {
	const { rules, container, contextFor } = options;
	const leaders: { element: Element; rule: DynamicContentRule }[] = [];

	for (const rule of rules) {
		if (rule.content.type !== "list") {
			continue;
		}

		const { items } = rule.content;
		const hasLeader = items.some(item => item.type === "leader");

		for (const element of queryAll(container, rule.selector)) {
			const context = contextFor(element);

			if (
				rule.pseudo === "footnote-call" ||
				rule.pseudo === "footnote-marker"
			) {
				element.textContent = evaluateToString(items, context);
				continue;
			}

			(element as HTMLElement).style.setProperty(
				`${CUSTOM_PROPERTIES.contentPrefix}${rule.id}`,
				contentToCSS(items, context),
			);

			if (hasLeader) {
				leaders.push({ element, rule });
			}
		}
	}

	for (const { element, rule } of leaders) {
		sizeLeader(element as HTMLElement, rule);
	}
}

/**
 * Sizes a leader pseudo-element so that it fills the rest of its line.
 * @param element The element whose pseudo-element contains the leader.
 * @param rule The dynamic content rule.
 */
function sizeLeader(element: HTMLElement, rule: DynamicContentRule): void {
	const doc = element.ownerDocument;
	const view = doc.defaultView;

	if (!view) {
		return;
	}

	const property = `${CUSTOM_PROPERTIES.leaderWidthPrefix}${rule.id}`;
	const contentProperty = `${CUSTOM_PROPERTIES.contentPrefix}${rule.id}`;
	const savedContent = element.style.getPropertyValue(contentProperty);
	element.style.removeProperty(property);

	// Collapse the pseudo-element while measuring so that content following
	// the leader stays on its natural line.
	element.style.setProperty(contentProperty, '""');

	try {
		measureAndSizeLeader(element, rule, property);
	} finally {
		element.style.setProperty(contentProperty, savedContent);
	}
}

function measureAndSizeLeader(
	element: HTMLElement,
	rule: DynamicContentRule,
	property: string,
): void {
	const doc = element.ownerDocument;
	const view = doc.defaultView!;

	// Determine the containing block's content box.
	let block: HTMLElement | null = element;

	while (block && view.getComputedStyle(block).display.startsWith("inline")) {
		block = block.parentElement;
	}

	if (!block) {
		return;
	}

	const blockStyle = view.getComputedStyle(block);
	const blockRect = block.getBoundingClientRect();
	const contentLeft =
		blockRect.left +
		parseFloat(blockStyle.borderLeftWidth) +
		parseFloat(blockStyle.paddingLeft);
	const contentRight =
		blockRect.right -
		parseFloat(blockStyle.borderRightWidth) -
		parseFloat(blockStyle.paddingRight);

	// Find where the pseudo-element starts: the end of the element's own
	// content (for ::after) or its start (for ::before).
	const range = doc.createRange();
	range.selectNodeContents(element);
	const rects = [...range.getClientRects()].filter(
		rect => rect.width > 0 || rect.height > 0,
	);
	let x = contentLeft;

	if (rule.pseudo === "after" && rects.length) {
		x = rects[rects.length - 1].right;
	} else if (rule.pseudo === "before") {
		x = rects.length ? rects[0].left : element.getBoundingClientRect().left;
	}

	let width = contentRight - x;

	// Leave room for inline content that follows the element on the same
	// line (e.g. a page number in a sibling span).
	if (rule.pseudo === "after") {
		width -= trailingWidth(
			doc,
			element,
			block,
			rects.length ? rects[rects.length - 1] : undefined,
		);
	}

	// Measure the minimum size (one pattern plus any trailing text).
	const pseudoStyle = view.getComputedStyle(element, `::${rule.pseudo}`);
	const minimum = measureMinimum(doc, element, pseudoStyle, rule);

	if (width < minimum) {
		width = contentRight - contentLeft;
	}

	element.style.setProperty(property, `${Math.max(0, Math.floor(width))}px`);
}

/**
 * Measures the width of inline content that follows an element within its
 * block on the same line (measured before the leader is sized).
 * @param doc The document.
 * @param element The element.
 * @param block The containing block.
 * @param lineRect A rect on the element's last line, if any.
 * @returns The trailing width.
 */
function trailingWidth(
	doc: Document,
	element: HTMLElement,
	block: HTMLElement,
	lineRect: DOMRect | undefined,
): number {
	if (element === block || !block.contains(element)) {
		return 0;
	}

	const elementRect = element.getBoundingClientRect();
	const lineTop = lineRect ? lineRect.top : elementRect.top;
	const lineBottom = lineRect ? lineRect.bottom : elementRect.bottom;
	const lineRight = lineRect ? lineRect.right : elementRect.right;
	const blockWidth = block.getBoundingClientRect().width;
	const range = doc.createRange();
	range.setStartAfter(element);
	range.setEnd(block, block.childNodes.length);
	let right = lineRight;

	for (const rect of range.getClientRects()) {
		if (rect.width <= 0 || rect.height <= 0) {
			continue;
		}

		// Only rects on the element's line count; rects as wide as the
		// block belong to block-level boxes and are ignored.
		const onLine = rect.bottom > lineTop + 1 && rect.top < lineBottom - 1;

		if (onLine && rect.width < blockWidth) {
			right = Math.max(right, rect.right);
		}
	}

	return Math.max(0, right - lineRight);
}

function measureMinimum(
	doc: Document,
	element: HTMLElement,
	pseudoStyle: CSSStyleDeclaration,
	rule: DynamicContentRule,
): number {
	if (rule.content.type !== "list") {
		return 0;
	}

	const items = rule.content.items;
	const leaderIndex = items.findIndex(item => item.type === "leader");
	const leader = items[leaderIndex];
	const pattern = leader && leader.type === "leader" ? leader.pattern : "";
	const trailing = (
		element.style.getPropertyValue(
			`${CUSTOM_PROPERTIES.contentPrefix}${rule.id}`,
		) ?? ""
	)
		.replace(/^"|"$/g, "")
		.replace(
			new RegExp(`${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}+`),
			"",
		);

	const probe = doc.createElement("span");
	probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${pseudoStyle.font};letter-spacing:${pseudoStyle.letterSpacing}`;
	probe.textContent = pattern.repeat(2) + trailing;
	element.append(probe);
	const width = probe.getBoundingClientRect().width;
	probe.remove();
	return width;
}
