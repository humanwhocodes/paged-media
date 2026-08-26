/**
 * @fileoverview CSS paged media polyfill for browsers.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import {
	parseComponentValues,
	parseStylesheet,
	type Stylesheet,
} from "./css/parser.js";
import {
	type PageSize,
	type StringAssignment,
	parseLength,
	parsePageSize,
} from "./css/values.js";
import { type CounterValues, computeCounters } from "./counters.js";
import { type PageStyleOptions } from "./page-rules.js";
import {
	type FeatureName,
	type SupportReport,
	detectSupport,
} from "./support.js";
import { BASE_STYLES } from "./styles.js";
import {
	type TransformResult,
	customPropertyRegistrations,
	transformStylesheets,
} from "./transform.js";
import { Chunker } from "./layout/chunker.js";
import { type ContentContext } from "./layout/content.js";
import { applyDynamicContent, targetId } from "./layout/dynamic.js";
import { type PageBox, renderMarginBoxes } from "./layout/page.js";
import { AssignmentStore } from "./layout/strings.js";

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

export interface PolyfillOptions {
	/** The document to polyfill. Defaults to the global document. */
	document?: Document;
	/**
	 * Apply the polyfill even if all paged media features used by the
	 * document are natively supported.
	 */
	force?: boolean;
	/** The page size used when `size` is `auto` or unspecified (e.g. "letter", "A4", "8.5in 11in"). */
	defaultPageSize?: string;
	/** The page margin used when unspecified (e.g. "0.4in"). */
	defaultMargin?: string;
	/** Whether rules inside `@media print` are applied unconditionally. Defaults to true. */
	hoistPrint?: boolean;
	/** Maximum number of pages to generate. Defaults to 5000. */
	maxPages?: number;
	/** Called with each page after it is laid out. */
	onPage?: (page: PageBox) => void;
}

export interface PolyfillResult {
	/** Whether the document was paginated by the polyfill. */
	polyfilled: boolean;
	/** The number of pages generated (0 if not polyfilled). */
	pageCount: number;
	/** The paged media features used by the document. */
	features: FeatureName[];
	/** The features that required the polyfill. */
	polyfilledFeatures: FeatureName[];
	/** The native support report. */
	support: SupportReport;
	/** The generated pages (empty if not polyfilled). */
	pages: PageBox[];
	/** Non-fatal problems encountered (e.g. stylesheets that could not be loaded). */
	warnings: string[];
}

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE: PageSize = { width: 8.5 * 96, height: 11 * 96 };
const DEFAULT_MARGIN = 0.4 * 96;

/** Results of documents that have already been paginated. */
const appliedResults = new WeakMap<Document, PolyfillResult>();

/**
 * Determines whether a `media` attribute value applies to print.
 * @param media The media attribute value.
 * @returns True if the stylesheet applies.
 */
function mediaApplies(media: string | null): boolean {
	if (!media || !media.trim()) {
		return true;
	}

	const value = media.trim().toLowerCase();

	if (value === "all" || /\bprint\b/.test(value)) {
		return true;
	}

	if (/^(only\s+)?screen\b/.test(value)) {
		return false;
	}

	return true;
}

/**
 * Fetches the text of a stylesheet URL, resolving `@import` rules.
 * @param url The URL.
 * @param depth Recursion depth guard.
 * @returns The CSS text, or undefined if it cannot be loaded.
 */
async function fetchStylesheet(
	url: string,
	depth = 0,
): Promise<string | undefined> {
	try {
		const response = await fetch(url);

		if (!response.ok) {
			return undefined;
		}

		return await resolveImports(await response.text(), url, depth);
	} catch {
		return undefined;
	}
}

const IMPORT_PATTERN =
	/@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)|"([^"]*)"|'([^']*)')\s*([^;]*);/g;

async function resolveImports(
	css: string,
	baseURL: string,
	depth: number,
): Promise<string> {
	if (depth > 5) {
		return css;
	}

	const matches = [...css.matchAll(IMPORT_PATTERN)];

	if (!matches.length) {
		return css;
	}

	let result = "";
	let last = 0;

	for (const match of matches) {
		const href =
			match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? "";
		const media = match[6]?.trim() ?? "";
		result += css.slice(last, match.index);
		last = match.index! + match[0].length;

		if (!mediaApplies(media)) {
			continue;
		}

		let imported: string | undefined;

		try {
			imported = await fetchStylesheet(
				new URL(href.trim(), baseURL).href,
				depth + 1,
			);
		} catch {
			imported = undefined;
		}

		if (imported !== undefined) {
			result += `\n${imported}\n`;
		}
	}

	result += css.slice(last);
	return result;
}

interface CollectedStylesheet {
	element: HTMLStyleElement | HTMLLinkElement;
	sheet: Stylesheet;
}

/**
 * Serializes a stylesheet from the CSSOM. Used as a fallback when the text
 * cannot be fetched (e.g. `file:` URLs); rules the browser does not
 * understand are lost.
 * @param element The link element.
 * @returns The CSS text, or undefined if the sheet is inaccessible.
 */
function cssomText(element: HTMLLinkElement): string | undefined {
	try {
		const { sheet } = element;

		if (!sheet) {
			return undefined;
		}

		return [...sheet.cssRules].map(rule => rule.cssText).join("\n");
	} catch {
		return undefined;
	}
}

/**
 * Collects and parses the document's stylesheets in order.
 * @param doc The document.
 * @param warnings Collects warnings.
 * @returns The stylesheets.
 */
async function collectStylesheets(
	doc: Document,
	warnings: string[],
): Promise<CollectedStylesheet[]> {
	const elements = doc.querySelectorAll<HTMLStyleElement | HTMLLinkElement>(
		'style, link[rel~="stylesheet"]',
	);
	const results: CollectedStylesheet[] = [];

	for (const element of elements) {
		if (element.hasAttribute("data-pm-styles")) {
			continue;
		}

		if (!mediaApplies(element.getAttribute("media"))) {
			continue;
		}

		let text: string | undefined;

		if (element instanceof HTMLLinkElement) {
			if (!element.href) {
				continue;
			}

			text = await fetchStylesheet(element.href);

			if (text === undefined) {
				text = cssomText(element);

				if (text === undefined) {
					warnings.push(`Could not load stylesheet: ${element.href}`);
					continue;
				}

				warnings.push(
					`Could not fetch stylesheet ${element.href}; using the browser's parsed copy, which drops unsupported rules.`,
				);
			}
		} else {
			text = await resolveImports(
				element.textContent ?? "",
				doc.baseURI,
				0,
			);
		}

		results.push({ element, sheet: parseStylesheet(text) });
	}

	return results;
}

function waitForReady(doc: Document): Promise<void> {
	if (doc.readyState !== "loading") {
		return Promise.resolve();
	}

	return new Promise(resolve => {
		doc.addEventListener("DOMContentLoaded", () => resolve(), {
			once: true,
		});
	});
}

//-----------------------------------------------------------------------------
// Polyfill
//-----------------------------------------------------------------------------

/**
 * Applies the paged media polyfill to a document.
 * @param options The polyfill options.
 * @returns The result.
 */
export async function polyfill(
	options: PolyfillOptions = {},
): Promise<PolyfillResult> {
	if (options === null || typeof options !== "object") {
		throw new TypeError("Expected an options object.");
	}

	const doc = options.document ?? globalThis.document;

	if (!doc) {
		throw new Error("No document available to polyfill.");
	}

	const previous = appliedResults.get(doc);

	if (previous) {
		return previous;
	}

	await waitForReady(doc);

	if (doc.fonts?.ready) {
		await doc.fonts.ready;
	}

	const support = detectSupport();
	const warnings: string[] = [];
	const collected = await collectStylesheets(doc, warnings);
	const transformed = transformStylesheets(
		collected.map(entry => entry.sheet),
		{ hoistPrint: options.hoistPrint ?? true },
	);
	const features = [...transformed.features];
	const polyfilledFeatures = features.filter(feature => !support[feature]);

	if (!options.force && polyfilledFeatures.length === 0) {
		return {
			polyfilled: false,
			pageCount: 0,
			features,
			polyfilledFeatures,
			support,
			pages: [],
			warnings,
		};
	}

	const pages = paginate(doc, collected, transformed, options);
	const result: PolyfillResult = {
		polyfilled: true,
		pageCount: pages.length,
		features,
		polyfilledFeatures,
		support,
		pages,
		warnings,
	};
	appliedResults.set(doc, result);
	return result;
}

function resolveDefaultSize(
	value: string | undefined,
	fontSize: number,
): PageSize {
	if (!value) {
		return DEFAULT_PAGE_SIZE;
	}

	return (
		parsePageSize(
			parseComponentValues(value),
			DEFAULT_PAGE_SIZE,
			fontSize,
		) ?? DEFAULT_PAGE_SIZE
	);
}

function resolveDefaultMargin(
	value: string | undefined,
	fontSize: number,
): number {
	if (!value) {
		return DEFAULT_MARGIN;
	}

	return (
		parseLength(parseComponentValues(value)[0], fontSize) ?? DEFAULT_MARGIN
	);
}

function paginate(
	doc: Document,
	collected: CollectedStylesheet[],
	transformed: TransformResult,
	options: PolyfillOptions,
): PageBox[] {
	const view = doc.defaultView!;
	const fontSize =
		parseFloat(view.getComputedStyle(doc.documentElement).fontSize) || 16;
	const pageStyleOptions: PageStyleOptions = {
		defaultSize: resolveDefaultSize(options.defaultPageSize, fontSize),
		defaultMargin: resolveDefaultMargin(options.defaultMargin, fontSize),
		fontSize,
	};

	// Replace the author stylesheets with the transformed versions.
	for (const { element } of collected) {
		element.setAttribute("data-pm-disabled", "");

		if (element instanceof HTMLLinkElement) {
			element.disabled = true;
		} else {
			element.disabled = true;
		}
	}

	const baseStyle = doc.createElement("style");
	baseStyle.setAttribute("data-pm-styles", "base");
	baseStyle.textContent = `${customPropertyRegistrations()}\n${BASE_STYLES}`;
	doc.head.append(baseStyle);

	const authorStyle = doc.createElement("style");
	authorStyle.setAttribute("data-pm-styles", "author");
	authorStyle.textContent = transformed.css;
	doc.head.append(authorStyle);

	const bodyStyle = doc.createElement("style");
	bodyStyle.setAttribute("data-pm-styles", "body");
	bodyStyle.textContent = `
body {
	margin: 0 !important;
	padding: 0 !important;
	max-width: none !important;
	width: auto !important;
	min-height: 0 !important;
	height: auto !important;
	display: block !important;
	columns: auto !important;
	overflow: visible !important;
}
@media screen {
	body { background: #888 !important; }
}`;
	doc.head.append(bodyStyle);

	// Move the content into a hidden source container.
	const source = doc.createElement("div");
	source.className = "pm-source";
	source.setAttribute("aria-hidden", "true");

	while (doc.body.firstChild) {
		source.append(doc.body.firstChild);
	}

	const container = doc.createElement("div");
	container.className = "pm-pages";
	doc.body.append(source, container);

	// Counters in the source are needed for string-set and cross references.
	let counters: Map<Element, CounterValues> | undefined;

	function countersOf(element: Element): CounterValues | undefined {
		if (!counters) {
			counters = computeCounters(source);
		}

		return counters.get(element);
	}

	const strings = new AssignmentStore<string>();
	const running = new AssignmentStore<Element>();
	const chunker = new Chunker({
		document: doc,
		source,
		container,
		pageRules: transformed.pageRules,
		pageStyleOptions,
		strings,
		running,
		countersOf,
		maxPages: options.maxPages,
		onPage: options.onPage,
	});

	const { pages, firstCloneOf } = chunker.layout();

	// Page counters.
	const counterValues = new Map<string, number>();

	for (const page of pages) {
		const { style } = page;

		for (const [name, value] of style.counterReset) {
			counterValues.set(name, value);
		}

		const increments = new Map(style.counterIncrement);

		if (!increments.has("page")) {
			increments.set("page", 1);
		}

		for (const [name, amount] of increments) {
			counterValues.set(name, (counterValues.get(name) ?? 0) + amount);
		}

		for (const [name, value] of counterValues) {
			page.counters.set(name, value);
		}
	}

	for (const page of pages) {
		page.counters.set("pages", pages.length);
		page.element.setAttribute(
			"data-pm-page-number",
			String(page.counters.get("page")),
		);
	}

	const pageOfElement = new Map<Element, PageBox>();

	for (const page of pages) {
		pageOfElement.set(page.element, page);
	}

	function pageOf(element: Element): PageBox | undefined {
		const pageElement = element.closest(".pm-page");
		return pageElement ? pageOfElement.get(pageElement) : undefined;
	}

	function resolveTarget(
		ref: Parameters<typeof targetId>[0],
		element?: Element,
	): Element | undefined {
		const id = targetId(ref, element, doc.baseURI);

		if (!id) {
			return undefined;
		}

		return source.querySelector(`#${CSS.escape(id)}`) ?? undefined;
	}

	function pageCounterOf(element: Element): number | undefined {
		const clone = firstCloneOf.get(element);
		const page = clone ? pageOf(clone) : undefined;
		return page?.counters.get("page");
	}

	function contextForPage(page: PageBox, element?: Element): ContentContext {
		const pageIndex = page.context.index - 1;
		const pageCounters = new Map(page.counters);

		if (element) {
			const footnote = element.closest("[data-pm-footnote]");

			if (footnote) {
				pageCounters.set(
					"footnote",
					Number(footnote.getAttribute("data-pm-footnote")),
				);
			}
		}

		return {
			document: doc,
			pageCounters,
			element,
			resolveString: (name: string, assignment: StringAssignment) =>
				strings.resolve(name, pageIndex, assignment),
			resolveElement: (name: string, assignment: StringAssignment) =>
				running.resolve(name, pageIndex, assignment),
			resolveTarget,
			countersOf: (target: Element) => {
				const original = source.contains(target)
					? target
					: (chunker.sourceOf(target) as Element | undefined);
				return original ? countersOf(original) : undefined;
			},
			pageCounterOf,
		};
	}

	// Margin boxes.
	for (const page of pages) {
		renderMarginBoxes(page, contextForPage(page), fontSize);
	}

	// Dynamic content in the flow.
	applyDynamicContent({
		rules: transformed.dynamicContent,
		container,
		contextFor: element => {
			const page = pageOf(element) ?? pages[0];
			const original = chunker.sourceOf(element) as Element | undefined;
			return contextForPage(page, original ?? element);
		},
	});

	// Print stylesheet: one named page per distinct sheet size.
	const printStyle = doc.createElement("style");
	printStyle.setAttribute("data-pm-styles", "print");
	printStyle.textContent = buildPrintStyles(pages);
	doc.head.append(printStyle);

	doc.dispatchEvent(
		new CustomEvent("pagedmedia:rendered", { detail: { pages } }),
	);
	return pages;
}

function buildPrintStyles(pages: PageBox[]): string {
	const sizes = new Map<
		string,
		{ width: number; height: number; orientation?: string }
	>();
	const rules: string[] = [];

	for (const page of pages) {
		const { geometry, style } = page;
		const key = `${geometry.sheetWidth}x${geometry.sheetHeight}:${style.orientation ?? ""}`;

		if (!sizes.has(key)) {
			sizes.set(key, {
				width: geometry.sheetWidth,
				height: geometry.sheetHeight,
				orientation: style.orientation,
			});
		}

		page.element.style.setProperty("page", `pm-${sizes.size}`);
		page.element.setAttribute(
			"data-pm-sheet",
			`pm-${[...sizes.keys()].indexOf(key) + 1}`,
		);
		page.element.style.setProperty(
			"page",
			`pm-${[...sizes.keys()].indexOf(key) + 1}`,
		);
	}

	let index = 0;

	for (const size of sizes.values()) {
		index++;
		const orientation = size.orientation
			? `page-orientation: ${size.orientation};`
			: "";
		rules.push(
			`@page pm-${index} { size: ${size.width}px ${size.height}px; margin: 0; ${orientation} }`,
		);
	}

	rules.push("@page { margin: 0; }");
	return rules.join("\n");
}

//-----------------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------------

export { detectSupport } from "./support.js";
export type { SupportReport, FeatureName } from "./support.js";
export type { PageBox, PageGeometry } from "./layout/page.js";
export type {
	PageContext,
	PageStyle,
	PageRule,
	Margins,
} from "./page-rules.js";
export { parseStylesheet, serializeStylesheet } from "./css/parser.js";
export type {
	Stylesheet,
	Rule,
	StyleRule,
	AtRule,
	Declaration,
} from "./css/parser.js";
export { transformStylesheets } from "./transform.js";
export type { TransformResult, DynamicContentRule } from "./transform.js";
export {
	parsePageSelectors,
	parsePageSize,
	parseContent,
	parseStringSet,
	formatCounter,
} from "./css/values.js";
export type {
	PageSelector,
	PageSize,
	ContentItem,
	ContentValue,
} from "./css/values.js";
export { resolvePageStyle, matchesPage } from "./page-rules.js";
export { computeMarginBoxSizes } from "./layout/margin-dimensions.js";
export type { MarginBoxMeasure } from "./layout/margin-dimensions.js";
export { AssignmentStore } from "./layout/strings.js";
export { computeCounters } from "./counters.js";
