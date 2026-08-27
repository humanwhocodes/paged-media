/**
 * @fileoverview Paginates source content into page boxes. Content is cloned
 * into a page until it overflows, at which point the best break point is
 * found (honoring forced breaks, break-inside/before/after: avoid, orphans,
 * and widows), the overflow is removed, and layout resumes on a new page.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { parseComponentValues } from "../css/parser.js";
import { parseStringSet } from "../css/values.js";
import type { CounterValues } from "../counters.js";
import {
	type PageContext,
	type PageRule,
	type PageStyle,
	type PageStyleOptions,
	resolvePageStyle,
} from "../page-rules.js";
import { CUSTOM_PROPERTIES } from "../transform.js";
import { evaluateToString } from "./content.js";
import { type PageBox, createPageBox } from "./page.js";
import type { AssignmentStore } from "./strings.js";

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

/** A position in the source content. */
export interface Position {
	/** The source node. */
	node: Node;
	/** For text nodes, the character offset; ignored for elements. */
	offset: number;
}

export type ForcedBreak = "page" | "left" | "right";

export interface ChunkerOptions {
	document: Document;
	/** The hidden element containing the source content. */
	source: Element;
	/** The element pages are appended to. */
	container: Element;
	pageRules: PageRule[];
	pageStyleOptions: PageStyleOptions;
	strings: AssignmentStore<string>;
	running: AssignmentStore<Element>;
	/** Returns counter values visible at a source element (for string-set). */
	countersOf?: (element: Element) => CounterValues | undefined;
	/** Maximum number of pages to generate (a safety limit). */
	maxPages?: number;
	/** Called after each page is created. */
	onPage?: (page: PageBox) => void;
}

export interface ChunkerResult {
	pages: PageBox[];
	/** Maps source elements to their first clone in the pages. */
	firstCloneOf: Map<Element, Element>;
}

interface FillResult {
	next: Position | null;
	forcedBreak: ForcedBreak | null;
}

interface BreakPoint {
	/** A node in the page (clone). */
	node: Node;
	/** For text nodes, the offset; for elements, 0 means "before the element". */
	offset: number;
}

interface EnterOutcome {
	descend: boolean;
	clone?: Element;
	result?: FillResult;
}

//-----------------------------------------------------------------------------
// Constants
//-----------------------------------------------------------------------------

const SKIPPED_TAGS = new Set([
	"SCRIPT",
	"STYLE",
	"TEMPLATE",
	"LINK",
	"META",
	"TITLE",
	"NOSCRIPT",
	"HEAD",
]);

const ATOMIC_TAGS = new Set([
	"IMG",
	"SVG",
	"CANVAS",
	"VIDEO",
	"AUDIO",
	"IFRAME",
	"OBJECT",
	"EMBED",
	"INPUT",
	"SELECT",
	"TEXTAREA",
	"BUTTON",
	"MATH",
	"HR",
	"BR",
	"METER",
	"PROGRESS",
	"PICTURE",
	"WBR",
]);

const ATOMIC_SELECTOR = [...ATOMIC_TAGS]
	.map(tag => tag.toLowerCase())
	.join(",");

const EPSILON = 0.5;

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

function isElement(node: Node): node is Element {
	return node.nodeType === 1;
}

function isText(node: Node): node is Text {
	return node.nodeType === 3;
}

function normalizeBreak(value: string): ForcedBreak | null {
	switch (value) {
		case "page":
		case "always":
		case "all":
			return "page";
		case "left":
		case "verso":
			return "left";
		case "right":
		case "recto":
			return "right";
		default:
			return null;
	}
}

function isAvoid(value: string): boolean {
	return value === "avoid" || value === "avoid-page";
}

/**
 * Returns the client rects of a range, ignoring empty rects.
 * @param range The range.
 * @returns The rects.
 */
function rectsOf(range: Range): DOMRect[] {
	return [...range.getClientRects()].filter(
		rect => rect.width > 0 && rect.height > 0,
	);
}

/**
 * Counts the number of line boxes covered by a list of rects, clustering
 * rects that vertically overlap into a single line.
 * @param rects The rects (in document order).
 * @returns The number of lines.
 */
export function countLines(rects: { top: number; bottom: number }[]): number {
	let lines = 0;
	let currentBottom = -Infinity;

	for (const rect of rects) {
		if (rect.top >= currentBottom - 1) {
			lines++;
			currentBottom = rect.bottom;
		} else {
			currentBottom = Math.max(currentBottom, rect.bottom);
		}
	}

	return lines;
}

/**
 * Collects the text nodes inside an element in document order.
 * @param root The element.
 * @returns The text nodes.
 */
function textNodesOf(root: Element): Text[] {
	const result: Text[] = [];
	const walker = root.ownerDocument.createTreeWalker(
		root,
		NodeFilter.SHOW_TEXT,
	);
	let node = walker.nextNode();

	while (node) {
		result.push(node as Text);
		node = walker.nextNode();
	}

	return result;
}

//-----------------------------------------------------------------------------
// Chunker
//-----------------------------------------------------------------------------

/**
 * Paginates source content into page boxes.
 */
interface TableColumns {
	/** The table's border box width. */
	width: number;
	/** The width of each column (border box of the cells). */
	widths: number[];
}

export class Chunker {
	#doc: Document;
	#source: Element;
	#container: Element;
	#pageRules: PageRule[];
	#pageStyleOptions: PageStyleOptions;
	#strings: AssignmentStore<string>;
	#running: AssignmentStore<Element>;
	#countersOf?: (element: Element) => CounterValues | undefined;
	#maxPages: number;
	#onPage?: (page: PageBox) => void;

	#pages: PageBox[] = [];
	#sourceOf = new WeakMap<Node, Node>();
	#textStart = new WeakMap<Text, number>();
	#firstCloneOf = new Map<Element, Element>();
	#tableColumns = new WeakMap<Element, TableColumns | null>();
	#pageNameCache = new Map<Element, string | undefined>();
	#direction: "ltr" | "rtl";
	#footnoteCounter = 0;

	// Per-page state.
	#page!: PageBox;
	#contentCount = 0;
	#pushed = new WeakSet<Element>();
	#anchors: { store: AssignmentStore<unknown>; anchor: Node }[] = [];
	/**
	 * The block container clone whose inline content overflowed; the cut is
	 * deferred until the block is complete so that orphans and widows can be
	 * evaluated against all of its lines.
	 */
	#deferredCut: Element | null = null;

	constructor(options: ChunkerOptions) {
		if (!options || typeof options !== "object") {
			throw new TypeError("Expected an options object.");
		}

		if (!options.source || !options.container) {
			throw new TypeError("Expected source and container elements.");
		}

		this.#doc = options.document;
		this.#source = options.source;
		this.#container = options.container;
		this.#pageRules = options.pageRules;
		this.#pageStyleOptions = options.pageStyleOptions;
		this.#strings = options.strings;
		this.#running = options.running;
		this.#countersOf = options.countersOf;
		this.#maxPages = options.maxPages ?? 5000;
		this.#onPage = options.onPage;

		const view = this.#doc.defaultView;
		const direction = view
			? view.getComputedStyle(this.#doc.documentElement).direction
			: "ltr";
		this.#direction = direction === "rtl" ? "rtl" : "ltr";
	}

	//-------------------------------------------------------------------------
	// Public API
	//-------------------------------------------------------------------------

	/**
	 * Lays out all of the source content into pages.
	 * @returns The result.
	 */
	layout(): ChunkerResult {
		let position: Position | null = this.#firstPosition();
		let pendingBreak: ForcedBreak | null = null;
		let lastName: string | undefined;
		let groupCount = 0;

		while (position || this.#pages.length === 0) {
			if (this.#pages.length >= this.#maxPages) {
				break;
			}

			const index = this.#pages.length + 1;
			const side = this.#sideFor(index);
			const name = position ? this.#pageNameAt(position) : undefined;

			// A forced break may require a page of a specific side, which
			// can generate a blank page in between.
			let required = pendingBreak;

			if (!required && position && isElement(position.node)) {
				required = this.#breakBefore(position.node);
			}

			if (
				(required === "left" || required === "right") &&
				required !== side &&
				(this.#pages.length > 0 || position)
			) {
				const blankName = this.#pages.length ? lastName : name;
				const groupIndex = blankName === lastName ? groupCount + 1 : 1;
				const blank = this.#createPage({
					name: blankName,
					index,
					groupIndex,
					first: index === 1,
					blank: true,
					side,
				});
				this.#container.append(blank.element);
				this.#pages.push(blank);
				this.#onPage?.(blank);
				lastName = blankName;
				groupCount = groupIndex;
				continue;
			}

			if (name === lastName && this.#pages.length > 0) {
				groupCount++;
			} else {
				groupCount = 1;
			}

			lastName = name;

			const page = this.#createPage({
				name,
				index,
				groupIndex: groupCount,
				first: index === 1,
				blank: false,
				side,
			});
			this.#container.append(page.element);
			this.#pages.push(page);

			if (!position) {
				this.#onPage?.(page);
				break;
			}

			const result = this.#fillPage(page, position);
			this.#onPage?.(page);

			if (
				result.next &&
				result.next.node === position.node &&
				result.next.offset === position.offset
			) {
				// No progress was made; skip the node to avoid an infinite loop.
				result.next = this.#positionAfter(position.node);
			}

			position = result.next;
			pendingBreak = result.forcedBreak;
		}

		return { pages: this.#pages, firstCloneOf: this.#firstCloneOf };
	}

	/**
	 * Returns the source node a page node was cloned from.
	 * @param node The node in a page.
	 * @returns The source node, if any.
	 */
	sourceOf(node: Node): Node | undefined {
		return this.#sourceOf.get(node);
	}

	//-------------------------------------------------------------------------
	// Page Creation
	//-------------------------------------------------------------------------

	#createPage(context: PageContext): PageBox {
		const style: PageStyle = resolvePageStyle(
			this.#pageRules,
			context,
			this.#pageStyleOptions,
		);
		const page = createPageBox(this.#doc, context, style);

		for (const [counter, value] of style.counterReset) {
			if (counter === "footnote") {
				this.#footnoteCounter = value;
			}
		}

		return page;
	}

	#sideFor(index: number): "left" | "right" {
		const odd = index % 2 === 1;

		if (this.#direction === "rtl") {
			return odd ? "left" : "right";
		}

		return odd ? "right" : "left";
	}

	//-------------------------------------------------------------------------
	// Source Traversal
	//-------------------------------------------------------------------------

	#firstPosition(): Position | null {
		const first = this.#source.firstChild;
		return first ? { node: first, offset: 0 } : null;
	}

	/**
	 * Returns the position of the next node in document order after the
	 * given node (not descending into it).
	 * @param node The source node.
	 * @returns The next position, or null at the end of the content.
	 */
	#positionAfter(node: Node): Position | null {
		let current: Node | null = node;

		while (current && current !== this.#source) {
			if (current.nextSibling) {
				return { node: current.nextSibling, offset: 0 };
			}

			current = current.parentNode;
		}

		return null;
	}

	/**
	 * Finds the first content-bearing node (non-whitespace text or atomic
	 * element) at or after a position, descending into elements.
	 * @param position The position.
	 * @returns The node, or undefined if there is no more content.
	 */
	#firstContentNode(position: Position): Node | undefined {
		let node: Node | null = position.node;

		while (node) {
			if (isText(node)) {
				const offset = node === position.node ? position.offset : 0;

				if (/\S/.test(node.data.slice(offset))) {
					return node;
				}
			} else if (
				isElement(node) &&
				!SKIPPED_TAGS.has(node.tagName) &&
				!this.#isOutOfFlow(node)
			) {
				if (ATOMIC_TAGS.has(node.tagName)) {
					return node;
				}

				if (node.firstChild) {
					node = node.firstChild;
					continue;
				}
			}

			// Advance without descending.
			let current: Node | null = node;
			node = null;

			while (current && current !== this.#source) {
				if (current.nextSibling) {
					node = current.nextSibling;
					break;
				}

				current = current.parentNode;
			}
		}

		return undefined;
	}

	#style(element: Element): CSSStyleDeclaration {
		return this.#doc.defaultView!.getComputedStyle(element);
	}

	/**
	 * Determines whether an element does not take part in the page flow
	 * (running elements and hidden elements), so it must not decide which
	 * named page a page starts with.
	 * @param element The source element.
	 * @returns True if the element is out of the flow.
	 */
	#isOutOfFlow(element: Element): boolean {
		const style = this.#style(element);
		const running = style
			.getPropertyValue(CUSTOM_PROPERTIES.running)
			.trim();
		return (
			style.display === "none" || (running !== "" && running !== "none")
		);
	}

	#breakBefore(element: Element): ForcedBreak | null {
		return normalizeBreak(this.#style(element).breakBefore);
	}

	#breakAfter(element: Element): ForcedBreak | null {
		return normalizeBreak(this.#style(element).breakAfter);
	}

	#pageNameFor(node: Node): string | undefined {
		let element: Element | null = isElement(node)
			? node
			: node.parentElement;

		while (element && element !== this.#source) {
			if (this.#pageNameCache.has(element)) {
				return this.#pageNameCache.get(element);
			}

			const value = this.#style(element).page;

			if (value && value !== "auto") {
				this.#pageNameCache.set(element, value);
				return value;
			}

			element = element.parentElement;
		}

		return undefined;
	}

	#pageNameAt(position: Position): string | undefined {
		const node = this.#firstContentNode(position) ?? position.node;
		return this.#pageNameFor(node);
	}

	#isBlockLevel(style: CSSStyleDeclaration): boolean {
		const { display } = style;
		return (
			display === "block" ||
			display === "flex" ||
			display === "grid" ||
			display === "table" ||
			display === "list-item" ||
			display === "flow-root" ||
			display.startsWith("block ")
		);
	}

	#isAtomicSource(element: Element, style: CSSStyleDeclaration): boolean {
		if (ATOMIC_TAGS.has(element.tagName)) {
			return true;
		}

		const { display, position } = style;

		if (
			display === "none" ||
			position === "absolute" ||
			position === "fixed"
		) {
			return true;
		}

		return (
			display === "inline-block" ||
			display === "inline-flex" ||
			display === "inline-grid" ||
			display === "inline-table" ||
			display === "flex" ||
			display === "grid" ||
			display.startsWith("inline ")
		);
	}

	//-------------------------------------------------------------------------
	// Cloning
	//-------------------------------------------------------------------------

	#cloneShallow(element: Element, continued: boolean): Element {
		const clone = element.cloneNode(false) as Element;
		this.#sourceOf.set(clone, element);

		if (continued) {
			const decoration = this.#style(element).boxDecorationBreak;
			clone.setAttribute(
				"data-pm-continued",
				decoration === "clone" ? "clone" : "slice",
			);
			clone.removeAttribute("id");
		} else if (!this.#firstCloneOf.has(element)) {
			this.#firstCloneOf.set(element, clone);
		}

		return clone;
	}

	#cloneDeep(element: Element): Element {
		const clone = element.cloneNode(true) as Element;
		this.#mapDeep(element, clone);
		return clone;
	}

	#mapDeep(source: Node, clone: Node): void {
		this.#sourceOf.set(clone, source);

		if (
			isElement(source) &&
			isElement(clone) &&
			!this.#firstCloneOf.has(source)
		) {
			this.#firstCloneOf.set(source, clone);
		}

		const sourceChildren = source.childNodes;
		const cloneChildren = clone.childNodes;

		for (let i = 0; i < sourceChildren.length; i++) {
			this.#mapDeep(sourceChildren[i], cloneChildren[i]);
		}
	}

	/**
	 * Recreates the ancestor chain of a source node inside the page body,
	 * marking each ancestor as continued from the previous page.
	 * @param node The source node.
	 * @returns The innermost clone (the parent for the node's clone).
	 */
	#buildAncestors(node: Node): Element {
		const ancestors: Element[] = [];
		let current = node.parentNode;

		while (current && current !== this.#source && isElement(current)) {
			ancestors.unshift(current);
			current = current.parentNode;
		}

		let parent: Element = this.#page.body;

		for (let i = 0; i < ancestors.length; i++) {
			const ancestor = ancestors[i];
			const clone = this.#cloneShallow(ancestor, true);
			const nextInChain: Node =
				i + 1 < ancestors.length ? ancestors[i + 1] : node;

			if (ancestor.tagName === "TABLE") {
				for (const child of ancestor.children) {
					if (
						child.tagName === "COLGROUP" ||
						child.tagName === "THEAD"
					) {
						clone.append(this.#cloneDeepUnmapped(child));
					}
				}

				this.#applyTableColumns(ancestor, clone);
			}

			if (ancestor.tagName === "OL") {
				this.#setListStart(
					ancestor as HTMLOListElement,
					clone as HTMLOListElement,
					nextInChain,
				);
			}

			parent.append(clone);
			this.#pushed.add(clone);
			parent = clone;
		}

		return parent;
	}

	#cloneDeepUnmapped(element: Element): Element {
		const clone = element.cloneNode(true) as Element;

		for (const withId of clone.querySelectorAll("[id]")) {
			withId.removeAttribute("id");
		}

		clone.removeAttribute("id");
		return clone;
	}

	#setListStart(
		list: HTMLOListElement,
		clone: HTMLOListElement,
		next: Node,
	): void {
		let number = list.hasAttribute("start") ? list.start : 1;
		let child = list.firstElementChild;

		while (child && child !== next && !child.contains(next)) {
			if (child.tagName === "LI") {
				number += list.reversed ? -1 : 1;
			}

			child = child.nextElementSibling;
		}

		clone.setAttribute("start", String(number));
	}

	//-------------------------------------------------------------------------
	// Page Filling
	//-------------------------------------------------------------------------

	#fillPage(page: PageBox, start: Position): FillResult {
		this.#page = page;
		this.#contentCount = 0;
		this.#pushed = new WeakSet();
		this.#anchors = [];
		this.#deferredCut = null;

		let parent = this.#buildAncestors(start.node);
		let node: Node | null = start.node;
		let textOffset = isText(start.node) ? start.offset : 0;
		let entering = true;

		while (node) {
			if (entering) {
				entering = false;

				if (isText(node)) {
					const text = node.data.slice(textOffset);
					const clone = this.#doc.createTextNode(text);
					this.#sourceOf.set(clone, node);
					this.#textStart.set(clone, textOffset);
					parent.append(clone);
					textOffset = 0;

					if (/\S/.test(text)) {
						this.#contentCount++;
						const result = this.#checkOverflow(
							start,
							clone,
							parent,
						);

						if (result) {
							return result;
						}
					}
				} else if (isElement(node)) {
					const outcome = this.#enterElement(node, parent, start);

					if (outcome.result) {
						return outcome.result;
					}

					if (outcome.descend && node.firstChild) {
						parent = outcome.clone!;
						node = node.firstChild;
						entering = true;
						continue;
					}

					if (outcome.descend) {
						// Empty element that was pushed: leave immediately.
						parent = outcome.clone!;
					}
				}
			}

			// Advance to the next node, leaving elements along the way.
			while (node) {
				if (isElement(node)) {
					const clone = parent;

					if (
						this.#pushed.has(clone) &&
						this.#sourceOf.get(clone) === node
					) {
						parent = clone.parentElement ?? this.#page.body;
						const result = this.#leaveElement(node, clone, start);

						if (result) {
							return result;
						}
					}
				}

				if (node.nextSibling) {
					node = node.nextSibling;
					entering = true;
					break;
				}

				node = node.parentNode;

				if (!node || node === this.#source) {
					node = null;
				}
			}
		}

		if (this.#deferredCut) {
			const result = this.#performDeferredCut(start);

			if (result) {
				return result;
			}
		}

		return { next: null, forcedBreak: null };
	}

	#enterElement(
		element: Element,
		parent: Element,
		start: Position,
	): EnterOutcome {
		if (SKIPPED_TAGS.has(element.tagName)) {
			return { descend: false };
		}

		const style = this.#style(element);
		const isFootnote =
			style.getPropertyValue(CUSTOM_PROPERTIES.float).trim() ===
			"footnote";
		let runningName = style
			.getPropertyValue(CUSTOM_PROPERTIES.running)
			.trim();

		if (runningName === "none") {
			runningName = "";
		}

		// A deferred cut happens as soon as the inline run ends.
		if (
			this.#deferredCut &&
			(isFootnote || runningName || !style.display.startsWith("inline"))
		) {
			const result = this.#performDeferredCut(start);

			if (result) {
				return { descend: false, result };
			}
		}

		// Footnotes are moved to the footnote area.
		if (isFootnote) {
			const result = this.#addFootnote(element, parent, style, start);
			return result ? { descend: false, result } : { descend: false };
		}

		// Running elements are removed from the flow.
		if (runningName) {
			const anchor = this.#doc.createElement("span");
			anchor.className = "pm-anchor";
			parent.append(anchor);
			this.#running.add(runningName, {
				page: this.#pages.length - 1,
				value: element,
				atPageStart: this.#contentCount === 0,
			});
			this.#anchors.push({ store: this.#running, anchor });

			if (!this.#firstCloneOf.has(element)) {
				this.#firstCloneOf.set(element, anchor);
			}

			return { descend: false };
		}

		// Forced breaks and page name changes.
		if (this.#contentCount > 0 && element !== start.node) {
			const forced = this.#breakBefore(element);

			if (forced) {
				return {
					descend: false,
					result: {
						next: { node: element, offset: 0 },
						forcedBreak: forced,
					},
				};
			}

			if (this.#isBlockLevel(style)) {
				const name = this.#pageNameFor(element);

				if (name !== this.#page.context.name) {
					return {
						descend: false,
						result: {
							next: { node: element, offset: 0 },
							forcedBreak: "page",
						},
					};
				}
			}
		}

		// Named strings.
		const stringSet = style
			.getPropertyValue(CUSTOM_PROPERTIES.stringSet)
			.trim();

		if (stringSet) {
			this.#assignStrings(element, stringSet, parent);
		}

		if (this.#isAtomicSource(element, style)) {
			const clone = this.#cloneDeep(element);
			parent.append(clone);

			if (style.display !== "none") {
				this.#contentCount++;
				const result = this.#checkOverflow(start, clone, parent);

				if (result) {
					return { descend: false, result };
				}
			}

			return { descend: false };
		}

		const clone = this.#cloneShallow(element, false);
		parent.append(clone);
		this.#pushed.add(clone);

		if (element.tagName === "TABLE") {
			this.#applyTableColumns(element, clone);
		}

		return { descend: true, clone };
	}

	/**
	 * Gives every clone of a table the column widths the complete table
	 * has, so that the columns line up across pages (a table laid out from
	 * only the rows on one page would size its columns differently).
	 * @param table The source table.
	 * @param clone The table clone that was just appended.
	 */
	#applyTableColumns(table: Element, clone: Element): void {
		let columns = this.#tableColumns.get(table);

		if (columns === undefined) {
			columns = this.#measureTableColumns(table, clone);
			this.#tableColumns.set(table, columns);
		}

		if (!columns) {
			return;
		}

		const element = clone as HTMLTableElement;
		element.style.setProperty("width", `${columns.width}px`);
		element.style.setProperty("table-layout", "fixed");

		if (element.querySelector(":scope > colgroup")) {
			return;
		}

		const colgroup = this.#doc.createElement("colgroup");

		for (const width of columns.widths) {
			const col = this.#doc.createElement("col");
			col.style.setProperty("width", `${width}px`);
			colgroup.append(col);
		}

		element.prepend(colgroup);
	}

	/**
	 * Measures the column widths of a complete table by laying out a
	 * temporary copy of it in place of the clone.
	 * @param table The source table.
	 * @param clone The table clone (already in the page).
	 * @returns The widths, or null if the columns cannot be determined.
	 */
	#measureTableColumns(table: Element, clone: Element): TableColumns | null {
		if (table.querySelector(":scope > colgroup")) {
			return null;
		}

		const probe = this.#cloneDeepUnmapped(table) as HTMLElement;
		probe.style.setProperty("visibility", "hidden", "important");
		clone.after(probe);

		try {
			for (const row of probe.querySelectorAll("tr")) {
				const cells = [...row.children].filter(
					cell => cell.tagName === "TD" || cell.tagName === "TH",
				);

				if (
					cells.length &&
					cells.every(cell => !cell.hasAttribute("colspan"))
				) {
					return {
						width: probe.getBoundingClientRect().width,
						widths: cells.map(
							cell => cell.getBoundingClientRect().width,
						),
					};
				}
			}

			return null;
		} finally {
			probe.remove();
		}
	}

	#leaveElement(
		element: Element,
		clone: Element,
		start: Position,
	): FillResult | null {
		const result =
			this.#deferredCut === clone
				? this.#performDeferredCut(start)
				: this.#checkOverflow(start);

		if (result) {
			return result;
		}

		const forced = this.#breakAfter(element);

		if (forced && this.#contentCount > 0) {
			const next = this.#positionAfter(element);

			if (next) {
				return { next, forcedBreak: forced };
			}
		}

		return null;
	}

	#assignStrings(element: Element, value: string, parent: Element): void {
		const entries = parseStringSet(parseComponentValues(value));

		if (!entries) {
			return;
		}

		const anchor = this.#doc.createElement("span");
		anchor.className = "pm-anchor";
		parent.append(anchor);

		for (const entry of entries) {
			const text = evaluateToString(entry.items, {
				document: this.#doc,
				pageCounters: new Map(),
				element,
				countersOf: this.#countersOf,
			});
			this.#strings.add(entry.name, {
				page: this.#pages.length - 1,
				value: text,
				atPageStart: this.#contentCount === 0,
			});
		}

		this.#anchors.push({ store: this.#strings, anchor });
	}

	//-------------------------------------------------------------------------
	// Footnotes
	//-------------------------------------------------------------------------

	/**
	 * Adds a footnote to the page. If the footnote does not fit, the line (or
	 * block, per footnote-policy) containing the call is moved to the next page.
	 * @param element The source footnote element.
	 * @param parent The clone parent for the call.
	 * @param style The footnote element's computed style.
	 * @param start The page's start position.
	 * @returns A fill result if the page must end, otherwise null.
	 */
	#addFootnote(
		element: Element,
		parent: Element,
		style: CSSStyleDeclaration,
		start: Position,
	): FillResult | null {
		const number = ++this.#footnoteCounter;

		// The call: a shell with the footnote's attributes (so selectors like
		// `.note::footnote-call` can match) wrapping the call marker.
		const shell = this.#doc.createElement("span");

		for (const attribute of element.attributes) {
			if (attribute.name !== "id") {
				shell.setAttribute(attribute.name, attribute.value);
			}
		}

		shell.setAttribute("data-pm-call-shell", "");
		shell.setAttribute("data-pm-footnote", String(number));

		const call = this.#doc.createElement("span");
		call.className = "pm-footnote-call";
		call.setAttribute("data-pm-footnote", String(number));
		call.textContent = String(number);
		shell.append(call);
		parent.append(shell);
		this.#sourceOf.set(shell, element);

		if (!this.#firstCloneOf.has(element)) {
			this.#firstCloneOf.set(element, shell);
		}

		// The body: a clone of the footnote element with a marker prepended.
		const body = this.#cloneDeepUnmapped(element);
		body.classList.add("pm-footnote");
		body.setAttribute("data-pm-footnote", String(number));
		body.setAttribute("data-pm-footnote-body", "");

		const display = style
			.getPropertyValue(CUSTOM_PROPERTIES.footnoteDisplay)
			.trim();

		if (display === "inline") {
			body.setAttribute("data-pm-display", "inline");
		}

		const marker = this.#doc.createElement("span");
		marker.className = "pm-footnote-marker";
		marker.setAttribute("data-pm-footnote", String(number));
		marker.textContent = String(number);
		body.prepend(marker);
		this.#page.footnotes.append(body);
		this.#contentCount++;

		if (!this.#overflows()) {
			return null;
		}

		// Determine whether the footnote itself caused the overflow.
		const policy = style
			.getPropertyValue(CUSTOM_PROPERTIES.footnotePolicy)
			.trim();
		const shellTop = shell.getBoundingClientRect().top;
		body.remove();

		if (this.#overflows()) {
			// The content before the call already overflowed.
			shell.remove();
			this.#footnoteCounter = number - 1;
			return this.#cut(start);
		}

		// Move the line (or block) containing the call to the next page.
		let point: BreakPoint = { node: shell, offset: 0 };
		const block = this.#closestBlock(shell);

		if (block && policy === "block") {
			point = { node: block, offset: 0 };
		} else if (block) {
			point = this.#lineStart(block, shellTop) ?? {
				node: block,
				offset: 0,
			};
		}

		if (!this.#isValidBreak(point)) {
			// Nothing else fits on this page; keep the footnote here and
			// let it overflow rather than producing an empty page.
			this.#page.footnotes.append(body);
			return null;
		}

		shell.remove();
		this.#footnoteCounter = number - 1;
		return this.#cutAt(point, start);
	}

	/**
	 * Finds the break point at the start of the line (within a block) whose
	 * top is at or below the given y coordinate.
	 * @param block The block element.
	 * @param lineTop The top of the line.
	 * @returns The break point, or null if it is the block's first line.
	 */
	#lineStart(block: Element, lineTop: number): BreakPoint | null {
		for (const text of textNodesOf(block)) {
			if (!/\S/.test(text.data)) {
				continue;
			}

			const range = this.#doc.createRange();
			range.selectNodeContents(text);
			const rects = rectsOf(range);

			if (rects.length === 0) {
				continue;
			}

			if (rects[0].top >= lineTop - 1) {
				return { node: text, offset: 0 };
			}

			if (rects[rects.length - 1].bottom <= lineTop + 1) {
				continue;
			}

			// The line starts inside this text node.
			return { node: text, offset: this.#fitOffset(text, lineTop) };
		}

		return null;
	}

	#removeOrphanedFootnotes(): void {
		const { body, footnotes } = this.#page;
		let lowest = Infinity;

		for (const note of [...footnotes.children]) {
			const number = note.getAttribute("data-pm-footnote");
			const call = body.querySelector(
				`.pm-footnote-call[data-pm-footnote="${number}"]`,
			);

			if (!call) {
				note.remove();
				lowest = Math.min(lowest, Number(number));
			}
		}

		if (lowest !== Infinity) {
			this.#footnoteCounter = lowest - 1;
		}
	}

	//-------------------------------------------------------------------------
	// Overflow Detection
	//-------------------------------------------------------------------------

	#limit(): number {
		return this.#page.body.getBoundingClientRect().bottom;
	}

	#overflows(): boolean {
		const { body } = this.#page;
		return body.scrollHeight > body.clientHeight + EPSILON;
	}

	/**
	 * Checks whether the page overflows and, if so, cuts it. When the
	 * overflowing node is inline content of a block that is still being
	 * filled, the cut is deferred until the block is complete.
	 * @param start The page's start position.
	 * @param appended The node that was just appended, if any.
	 * @param parent The clone the node was appended to.
	 * @returns The fill result if the page was cut, otherwise null.
	 */
	#checkOverflow(
		start: Position,
		appended?: Node,
		parent?: Element,
	): FillResult | null {
		if (this.#deferredCut) {
			return null;
		}

		if (!this.#overflows()) {
			return null;
		}

		if (appended && parent) {
			const block = this.#closestBlock(appended);

			if (
				block &&
				block.contains(parent) &&
				this.#isInlineContent({ node: appended, offset: 0 }, block)
			) {
				this.#deferredCut = block;
				return null;
			}
		}

		return this.#cut(start);
	}

	#performDeferredCut(start: Position): FillResult | null {
		this.#deferredCut = null;
		return this.#cut(start);
	}

	/**
	 * Finds the first point in the page body that crosses the bottom limit.
	 * @param container The element to search.
	 * @param limit The bottom limit.
	 * @returns The overflow point, or null if nothing overflows.
	 */
	#findOverflow(container: Element, limit: number): BreakPoint | null {
		for (const child of container.childNodes) {
			if (isText(child)) {
				if (!/\S/.test(child.data)) {
					continue;
				}

				const range = this.#doc.createRange();
				range.selectNodeContents(child);
				const rects = rectsOf(range);

				if (rects.length === 0) {
					continue;
				}

				if (rects[0].top >= limit - EPSILON) {
					return { node: child, offset: 0 };
				}

				if (rects[rects.length - 1].bottom > limit + EPSILON) {
					const offset = this.#fitOffset(child, limit);

					if (/\S/.test(child.data.slice(offset))) {
						return { node: child, offset };
					}
				}

				continue;
			}

			if (!isElement(child)) {
				continue;
			}

			if (
				child.classList.contains("pm-anchor") ||
				child.tagName === "COLGROUP" ||
				child.tagName === "COL"
			) {
				continue;
			}

			const rects = child.getClientRects();

			if (rects.length === 0) {
				continue;
			}

			const rect = child.getBoundingClientRect();

			if (rect.height === 0 && rect.width === 0) {
				continue;
			}

			if (rect.top >= limit - EPSILON) {
				return { node: child, offset: 0 };
			}

			if (
				rect.bottom <= limit + EPSILON &&
				this.#floatBottom(child, rect.bottom) <= limit + EPSILON
			) {
				continue;
			}

			if (this.#isAtomicClone(child)) {
				return { node: child, offset: 0 };
			}

			const inner = this.#findOverflow(child, limit);

			if (inner) {
				return inner;
			}

			// The children fit but the element's own bottom edge does not
			// (bottom padding/border). Break before it when possible.
			if (this.#hasContentBefore(child)) {
				return { node: child, offset: 0 };
			}
		}

		return null;
	}

	#isAtomicClone(element: Element): boolean {
		if (ATOMIC_TAGS.has(element.tagName)) {
			return true;
		}

		if (element.hasAttribute("data-pm-call-shell")) {
			return true;
		}

		const style = this.#style(element);
		const { display } = style;

		if (
			display === "inline-block" ||
			display === "inline-flex" ||
			display === "inline-grid" ||
			display === "inline-table"
		) {
			return true;
		}

		const bodyHeight = this.#page.body.clientHeight;

		if (display === "flex" || display === "grid") {
			// Only atomic when it can fit on a page.
			return element.getBoundingClientRect().height <= bodyHeight;
		}

		if (element.tagName === "TR" || isAvoid(style.breakInside)) {
			// Rows and avoid-inside elements are kept together unless taller
			// than the page. The element may still be being filled, so its
			// complete height is measured rather than the partial clone's.
			return this.#completeHeight(element) <= bodyHeight;
		}

		return element.childNodes.length === 0;
	}

	/**
	 * Returns the height a clone will have once all of its source content
	 * has been cloned. Clones that are still being filled (they contain the
	 * last node on the page) are measured with a temporary complete copy.
	 * @param element The clone.
	 * @returns The height.
	 */
	#completeHeight(element: Element): number {
		const source = this.#sourceOf.get(element);
		let last: Node = this.#page.body;

		while (last.lastChild) {
			last = last.lastChild;
		}

		if (
			!source ||
			!isElement(source) ||
			last === element ||
			!element.contains(last)
		) {
			return element.getBoundingClientRect().height;
		}

		const probe = this.#cloneDeepUnmapped(source) as HTMLElement;
		probe.style.setProperty("visibility", "hidden", "important");
		element.after(probe);
		const height = probe.getBoundingClientRect().height;
		probe.remove();
		return height;
	}

	/**
	 * Returns the bottom edge of the lowest floated descendant of an
	 * element, which can extend below the element's own box.
	 * @param element The element.
	 * @param bottom The element's own bottom edge.
	 * @returns The lowest bottom edge.
	 */
	#floatBottom(element: Element, bottom: number): number {
		const range = this.#doc.createRange();
		range.selectNodeContents(element);
		let lowest = bottom;

		for (const rect of range.getClientRects()) {
			if (rect.bottom > lowest) {
				lowest = rect.bottom;
			}
		}

		if (lowest <= bottom + EPSILON) {
			return bottom;
		}

		// Only floats count; confirm that one actually reaches that low.
		let floatBottom = bottom;

		for (const descendant of element.querySelectorAll("*")) {
			if (this.#style(descendant).float !== "none") {
				floatBottom = Math.max(
					floatBottom,
					descendant.getBoundingClientRect().bottom,
				);
			}
		}

		return floatBottom;
	}

	/**
	 * Finds the largest offset in a text node such that the text before it
	 * fits above the limit.
	 * @param text The text node.
	 * @param limit The bottom limit.
	 * @returns The offset.
	 */
	#fitOffset(text: Text, limit: number): number {
		const range = this.#doc.createRange();
		range.setStart(text, 0);
		let low = 0;
		let high = text.data.length;

		while (low < high) {
			const mid = Math.ceil((low + high) / 2);
			range.setEnd(text, mid);
			const rects = rectsOf(range);
			const bottom = rects.length
				? rects[rects.length - 1].bottom
				: -Infinity;

			if (bottom <= limit + EPSILON) {
				low = mid;
			} else {
				high = mid - 1;
			}
		}

		return low;
	}

	#hasContentBefore(node: Node): boolean {
		const { body } = this.#page;

		if (!body.contains(node)) {
			return false;
		}

		const range = this.#doc.createRange();
		range.setStart(body, 0);
		range.setEndBefore(node);

		if (/\S/.test(range.toString())) {
			return true;
		}

		for (const atomic of body.querySelectorAll(ATOMIC_SELECTOR)) {
			if (atomic === node || atomic.contains(node)) {
				break;
			}

			if (
				atomic.compareDocumentPosition(node) &
				Node.DOCUMENT_POSITION_FOLLOWING
			) {
				return true;
			}
		}

		return false;
	}

	//-------------------------------------------------------------------------
	// Break Point Selection
	//-------------------------------------------------------------------------

	#isBlockContainer(style: CSSStyleDeclaration): boolean {
		const { display } = style;
		return (
			this.#isBlockLevel(style) ||
			display === "table-cell" ||
			display === "table-caption" ||
			display === "inline-block" ||
			display === "inline-flex" ||
			display === "inline-grid"
		);
	}

	#closestBlock(node: Node): Element | null {
		let element: Element | null = isElement(node)
			? node
			: node.parentElement;

		while (element && element !== this.#page.body) {
			if (this.#isBlockContainer(this.#style(element))) {
				return element;
			}

			element = element.parentElement;
		}

		return null;
	}

	/**
	 * Determines whether a break point sits in the inline content of a
	 * block (as opposed to between block-level children, rows, etc.).
	 * @param point The break point.
	 * @param block The block container.
	 * @returns True if the point is inline content of the block.
	 */
	#isInlineContent(point: BreakPoint, block: Element): boolean {
		let element: Element | null = isElement(point.node)
			? point.node
			: point.node.parentElement;

		while (element && element !== block) {
			const { display } = this.#style(element);

			if (!display.startsWith("inline") && display !== "contents") {
				return false;
			}

			element = element.parentElement;
		}

		return element === block;
	}

	#lineRects(
		from: Node,
		fromOffset: number,
		to: Node,
		toOffset: number,
	): DOMRect[] {
		const range = this.#doc.createRange();
		range.setStart(from, fromOffset);
		range.setEnd(to, toOffset);
		return rectsOf(range);
	}

	#linesBefore(block: Element, point: BreakPoint): number {
		const range = this.#doc.createRange();
		range.setStart(block, 0);

		if (isText(point.node)) {
			range.setEnd(point.node, point.offset);
		} else {
			range.setEndBefore(point.node);
		}

		return countLines(rectsOf(range));
	}

	#linesAfter(block: Element, point: BreakPoint): number {
		const range = this.#doc.createRange();

		if (isText(point.node)) {
			range.setStart(point.node, point.offset);
		} else {
			range.setStartBefore(point.node);
		}

		range.setEnd(block, block.childNodes.length);
		return countLines(rectsOf(range));
	}

	/**
	 * Finds the break point at the end of the given number of lines within a
	 * block.
	 * @param block The block element.
	 * @param lines The number of lines to keep.
	 * @returns The break point, or null if not found.
	 */
	#pointAfterLines(block: Element, lines: number): BreakPoint | null {
		let result: BreakPoint | null = null;

		for (const text of textNodesOf(block)) {
			if (!/\S/.test(text.data)) {
				continue;
			}

			const count = countLines(
				this.#lineRects(block, 0, text, text.data.length),
			);

			if (count <= lines) {
				result = { node: text, offset: text.data.length };
				continue;
			}

			// The boundary is inside this text node.
			let low = 0;
			let high = text.data.length;

			while (low < high) {
				const mid = Math.ceil((low + high) / 2);

				if (countLines(this.#lineRects(block, 0, text, mid)) <= lines) {
					low = mid;
				} else {
					high = mid - 1;
				}
			}

			return { node: text, offset: low };
		}

		return result;
	}

	/**
	 * Adjusts a break point inside a block's inline content to satisfy
	 * orphans and widows.
	 * @param point The break point.
	 * @returns The adjusted break point.
	 */
	#applyOrphansWidows(point: BreakPoint): BreakPoint {
		const block = this.#closestBlock(point.node);

		if (!block || block === point.node) {
			return point;
		}

		// Only applies to breaks between lines of inline content.
		if (!this.#isInlineContent(point, block)) {
			return point;
		}

		const style = this.#style(block);
		const orphans = Math.max(1, parseInt(style.orphans, 10) || 2);
		const widows = Math.max(1, parseInt(style.widows, 10) || 2);
		const before = this.#linesBefore(block, point);
		const after = this.#linesAfter(block, point);

		if (before === 0) {
			return { node: block, offset: 0 };
		}

		let keep = before;

		if (after < widows) {
			keep = before - (widows - after);
		}

		if (keep < orphans || keep <= 0) {
			return { node: block, offset: 0 };
		}

		if (keep === before) {
			return point;
		}

		const moved = this.#pointAfterLines(block, keep);

		if (!moved) {
			return { node: block, offset: 0 };
		}

		if (isText(moved.node) && moved.offset >= moved.node.data.length) {
			// Break after the text node entirely.
			const next = this.#nextInBlock(moved.node, block);
			return next ? { node: next, offset: 0 } : point;
		}

		return moved;
	}

	#nextInBlock(node: Node, block: Element): Node | null {
		let current: Node | null = node;

		while (current && current !== block) {
			if (current.nextSibling) {
				return current.nextSibling;
			}

			current = current.parentNode;
		}

		return null;
	}

	/**
	 * Moves the break point earlier to satisfy break-inside/before/after: avoid.
	 * @param point The break point.
	 * @returns The adjusted break point.
	 */
	#applyAvoidConstraints(point: BreakPoint): BreakPoint {
		let current = point;

		// break-inside: avoid on ancestors
		let element: Element | null = current.node.parentElement;

		while (element && element !== this.#page.body) {
			if (
				isAvoid(this.#style(element).breakInside) &&
				this.#hasContentBefore(element)
			) {
				current = { node: element, offset: 0 };
			}

			element = element.parentElement;
		}

		// break-before: avoid on the element and break-after: avoid on the
		// previous sibling.
		let guard = 0;

		while (guard++ < 100) {
			const node = current.node;

			if (!isElement(node) || current.offset !== 0) {
				break;
			}

			const previous = this.#previousContentSibling(node);

			if (!previous) {
				break;
			}

			const avoidBefore = isAvoid(this.#style(node).breakBefore);
			const avoidAfter =
				isElement(previous) &&
				isAvoid(this.#style(previous).breakAfter);

			if (
				(avoidBefore || avoidAfter) &&
				this.#hasContentBefore(previous)
			) {
				current = { node: previous, offset: 0 };
				continue;
			}

			break;
		}

		return current;
	}

	#previousContentSibling(node: Node): Node | null {
		let previous = node.previousSibling;

		while (previous) {
			if (
				isElement(previous) &&
				!previous.classList.contains("pm-anchor")
			) {
				return previous;
			}

			if (isText(previous) && /\S/.test(previous.data)) {
				return previous;
			}

			previous = previous.previousSibling;
		}

		return null;
	}

	/**
	 * Moves a break point that sits before the first content of its parent
	 * up to the parent, so that no empty element shells are left behind.
	 * @param point The break point.
	 * @returns The hoisted break point.
	 */
	#hoistBreakPoint(point: BreakPoint): BreakPoint {
		if (isText(point.node) && point.offset > 0) {
			return point;
		}

		let { node } = point;

		while (node.parentNode && node.parentNode !== this.#page.body) {
			const parent = node.parentNode as Element;

			if (this.#hasContentWithin(parent, node)) {
				break;
			}

			node = parent;
		}

		return { node, offset: 0 };
	}

	#hasContentWithin(parent: Element, before: Node): boolean {
		for (const child of parent.childNodes) {
			if (child === before) {
				return false;
			}

			if (isText(child) && /\S/.test(child.data)) {
				return true;
			}

			if (
				isElement(child) &&
				!child.classList.contains("pm-anchor") &&
				(ATOMIC_TAGS.has(child.tagName) ||
					child.querySelector(ATOMIC_SELECTOR) !== null ||
					/\S/.test(child.textContent ?? ""))
			) {
				return true;
			}
		}

		return false;
	}

	//-------------------------------------------------------------------------
	// Cutting
	//-------------------------------------------------------------------------

	/**
	 * Cuts the page at the best break point for the current overflow.
	 * @param start The page's start position.
	 * @returns The fill result, or null if no break point could be found
	 *      (in which case layout continues on the page).
	 */
	#cut(start: Position): FillResult | null {
		const raw = this.#findOverflow(this.#page.body, this.#limit());

		if (!raw) {
			return null;
		}

		return this.#cutAt(raw, start);
	}

	/**
	 * Cuts the page at (or before) the given point after applying orphans,
	 * widows, and avoid constraints.
	 * @param raw The overflow point.
	 * @param start The page's start position.
	 * @returns The fill result.
	 */
	#cutAt(raw: BreakPoint, start: Position): FillResult {
		let point = this.#hoistBreakPoint(raw);
		point = this.#applyOrphansWidows(point);
		point = this.#hoistBreakPoint(this.#applyAvoidConstraints(point));

		if (!this.#isValidBreak(point)) {
			// The constrained break would leave the page empty; fall back to
			// the raw overflow point.
			point = this.#hoistBreakPoint(raw);

			if (!this.#isValidBreak(point)) {
				// The very first content is too tall for the page: keep it
				// whole and break after it.
				const after = this.#pointAfter(point.node);

				if (!after) {
					const source = this.#sourceOf.get(point.node);
					return {
						next: source ? this.#positionAfter(source) : null,
						forcedBreak: null,
					};
				}

				point = after;
			}
		}

		const next = this.#positionFor(point);
		this.#removeFrom(point);
		this.#removeOrphanedFootnotes();
		this.#rollbackAssignments();

		if (next && next.node === start.node && next.offset <= start.offset) {
			return { next: this.#positionAfter(start.node), forcedBreak: null };
		}

		return { next, forcedBreak: null };
	}

	#isValidBreak(point: BreakPoint): boolean {
		if (isText(point.node) && point.offset > 0) {
			return (
				/\S/.test(point.node.data.slice(0, point.offset)) ||
				this.#hasContentBefore(point.node)
			);
		}

		return this.#hasContentBefore(point.node);
	}

	#pointAfter(node: Node): BreakPoint | null {
		let current: Node | null = node;

		while (current && current !== this.#page.body) {
			if (current.nextSibling) {
				return { node: current.nextSibling, offset: 0 };
			}

			current = current.parentNode;
		}

		return null;
	}

	#positionFor(point: BreakPoint): Position | null {
		const source = this.#sourceOf.get(point.node);

		if (!source) {
			// Nodes without a source (e.g. repeated table headers) cannot be
			// resumed from; use the next node with a source.
			const after = this.#pointAfter(point.node);
			return after ? this.#positionFor(after) : null;
		}

		if (isText(point.node)) {
			return {
				node: source,
				offset: (this.#textStart.get(point.node) ?? 0) + point.offset,
			};
		}

		return { node: source, offset: 0 };
	}

	#removeFrom(point: BreakPoint): void {
		const { node } = point;

		if (isText(node) && point.offset > 0) {
			node.data = node.data.slice(0, point.offset);
			this.#removeAfter(node);
			this.#markSplit(node.parentElement);
			return;
		}

		const parent = node.parentElement;
		this.#removeAfter(node);
		node.parentNode?.removeChild(node);
		this.#markSplit(parent);
	}

	#removeAfter(node: Node): void {
		let current: Node | null = node;

		while (current && current !== this.#page.body) {
			while (current.nextSibling) {
				current.nextSibling.remove();
			}

			current = current.parentNode;
		}
	}

	#markSplit(element: Element | null): void {
		let current = element;
		let alignFixed = false;

		while (current && current !== this.#page.body) {
			const style = this.#style(current);

			if (style.boxDecorationBreak !== "clone") {
				current.setAttribute("data-pm-split-after", "");
			}

			// The last line of a justified block that continues on the next
			// page is not its real last line, so it is justified too. Only
			// the innermost block is changed: `text-align-last` is inherited
			// and must not leak into complete blocks on the same page.
			if (
				!alignFixed &&
				!style.display.startsWith("inline") &&
				style.textAlign === "justify"
			) {
				(current as HTMLElement).style.setProperty(
					"text-align-last",
					"justify",
				);
			}

			if (!style.display.startsWith("inline")) {
				alignFixed = true;
			}

			current = current.parentElement;
		}
	}

	#rollbackAssignments(): void {
		const { body } = this.#page;
		const pageIndex = this.#pages.length - 1;
		const removed = this.#anchors.filter(
			entry => !body.contains(entry.anchor),
		);

		if (removed.length === 0) {
			return;
		}

		// Assignments are recorded in document order, so the ones to drop are
		// the trailing assignments on this page for each store.
		for (const store of new Set(removed.map(entry => entry.store))) {
			const kept = this.#anchors.filter(
				entry => entry.store === store && body.contains(entry.anchor),
			).length;
			let seen = 0;
			store.rollback(
				pageIndex,
				entry => entry.page === pageIndex && seen++ < kept,
			);
		}
	}
}
