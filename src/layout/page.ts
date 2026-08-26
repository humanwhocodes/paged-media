/**
 * @fileoverview Builds the DOM for a single page box, including the page
 * area, margin boxes, footnote area, and printer's marks.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import {
	type ComponentValue,
	type Declaration,
	isToken,
	serialize,
} from "../css/parser.js";
import { parseLength, parseContent, type ContentItem } from "../css/values.js";
import {
	type MarginBoxName,
	type PageContext,
	type PageStyle,
	MARGIN_BOX_NAMES,
} from "../page-rules.js";
import { type ContentContext, evaluateToNodes } from "./content.js";
import {
	type MarginBoxMeasure,
	computeMarginBoxSizes,
} from "./margin-dimensions.js";

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

export interface PageGeometry {
	/** Trim (page) size in pixels. */
	width: number;
	height: number;
	/** Distance from the sheet edge to the trim edge. */
	outset: number;
	bleed: number;
	/** Sheet size in pixels (page plus bleed and marks). */
	sheetWidth: number;
	sheetHeight: number;
}

export interface PageBox {
	context: PageContext;
	style: PageStyle;
	geometry: PageGeometry;
	/** The outer page element (the sheet). */
	element: HTMLElement;
	/** The page box (trim plus bleed). */
	pageBox: HTMLElement;
	/** The element positioned at the trim box holding margin boxes and the area. */
	trim: HTMLElement;
	/** The page area (content plus footnotes). */
	area: HTMLElement;
	/** The flow content container. */
	body: HTMLElement;
	/** The footnote area. */
	footnotes: HTMLElement;
	/** Page counter values for this page. */
	counters: Map<string, number>;
}

//-----------------------------------------------------------------------------
// Constants
//-----------------------------------------------------------------------------

/** Extra room around the bleed area for printer's marks (10mm). */
const MARK_AREA = (96 / 25.4) * 10;
/** Length of crop mark lines (6mm). */
const MARK_LENGTH = (96 / 25.4) * 6;
/** Gap between bleed edge and crop marks (2mm). */
const MARK_GAP = (96 / 25.4) * 2;

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

function px(value: number): string {
	return `${value}px`;
}

function declarationsToStyle(
	declarations: Declaration[],
	skip: Set<string> = new Set(),
): string {
	return declarations
		.filter(declaration => !skip.has(declaration.name))
		.map(
			declaration =>
				`${declaration.name}: ${serialize(declaration.value)}${
					declaration.important ? " !important" : ""
				}`,
		)
		.join("; ");
}

/**
 * Computes the page geometry from a page style.
 * @param style The page style.
 * @returns The geometry.
 */
export function computeGeometry(style: PageStyle): PageGeometry {
	const hasMarks = style.marks.crop || style.marks.cross;
	const bleed = Math.max(0, style.bleed);
	const outset = bleed + (hasMarks ? MARK_AREA : 0);

	return {
		width: style.size.width,
		height: style.size.height,
		outset,
		bleed,
		sheetWidth: style.size.width + 2 * outset,
		sheetHeight: style.size.height + 2 * outset,
	};
}

//-----------------------------------------------------------------------------
// Page Construction
//-----------------------------------------------------------------------------

/**
 * Creates the DOM structure for a page.
 * @param doc The document.
 * @param context The page context.
 * @param style The resolved page style.
 * @returns The page box.
 */
export function createPageBox(
	doc: Document,
	context: PageContext,
	style: PageStyle,
): PageBox {
	const geometry = computeGeometry(style);
	const { margins } = style;

	const element = doc.createElement("div");
	element.className = `pm-page pm-${context.side}`;
	element.setAttribute("data-pm-page-index", String(context.index));

	if (context.name) {
		element.setAttribute("data-pm-page-name", context.name);
	}

	if (context.first) {
		element.classList.add("pm-first");
	}

	if (context.blank) {
		element.classList.add("pm-blank");
		element.setAttribute("data-pm-blank", "");
	}

	element.style.width = px(geometry.sheetWidth);
	element.style.height = px(geometry.sheetHeight);

	const pageBox = doc.createElement("div");
	pageBox.className = "pm-pagebox";
	pageBox.style.left = px(geometry.outset - geometry.bleed);
	pageBox.style.top = px(geometry.outset - geometry.bleed);
	pageBox.style.width = px(geometry.width + 2 * geometry.bleed);
	pageBox.style.height = px(geometry.height + 2 * geometry.bleed);

	const pageBoxStyle = declarationsToStyle(
		style.declarations.filter(declaration =>
			/^(background|color|font|line-height|letter-spacing|word-spacing|text-|direction|writing-mode|-webkit-)/.test(
				declaration.name,
			),
		),
	);

	if (pageBoxStyle) {
		pageBox.style.cssText += `;${pageBoxStyle}`;
	}

	const trim = doc.createElement("div");
	trim.className = "pm-trim";
	trim.style.cssText = `position:absolute;left:${px(geometry.bleed)};top:${px(geometry.bleed)};width:${px(geometry.width)};height:${px(geometry.height)}`;

	const area = doc.createElement("div");
	area.className = "pm-area";
	area.style.left = px(margins.left);
	area.style.top = px(margins.top);
	area.style.width = px(
		Math.max(0, geometry.width - margins.left - margins.right),
	);
	area.style.height = px(
		Math.max(0, geometry.height - margins.top - margins.bottom),
	);

	const areaStyle = declarationsToStyle(
		style.declarations.filter(declaration =>
			/^(border|padding|outline|box-shadow)/.test(declaration.name),
		),
	);

	if (areaStyle) {
		area.style.cssText += `;${areaStyle}`;
	}

	const body = doc.createElement("div");
	body.className = "pm-body";

	const footnotes = doc.createElement("div");
	footnotes.className = "pm-footnotes";

	const footnoteStyle = declarationsToStyle(
		style.footnote,
		new Set(["float", "counter-increment", "counter-reset", "content"]),
	);

	if (footnoteStyle) {
		footnotes.style.cssText = footnoteStyle;
	}

	area.append(body, footnotes);
	trim.append(area);
	pageBox.append(trim);
	element.append(pageBox);

	if (style.marks.crop || style.marks.cross) {
		element.append(createMarks(doc, geometry, style.marks));
	}

	return {
		context,
		style,
		geometry,
		element,
		pageBox,
		trim,
		area,
		body,
		footnotes,
		counters: new Map(),
	};
}

//-----------------------------------------------------------------------------
// Printer's Marks
//-----------------------------------------------------------------------------

function createMarks(
	doc: Document,
	geometry: PageGeometry,
	marks: { crop: boolean; cross: boolean },
): SVGSVGElement {
	const SVG_NS = "http://www.w3.org/2000/svg";
	const svg = doc.createElementNS(SVG_NS, "svg");
	svg.setAttribute("class", "pm-marks");
	svg.setAttribute("width", String(geometry.sheetWidth));
	svg.setAttribute("height", String(geometry.sheetHeight));
	svg.setAttribute(
		"viewBox",
		`0 0 ${geometry.sheetWidth} ${geometry.sheetHeight}`,
	);
	svg.setAttribute("aria-hidden", "true");

	const { outset, bleed, sheetWidth, sheetHeight } = geometry;
	const left = outset;
	const right = sheetWidth - outset;
	const top = outset;
	const bottom = sheetHeight - outset;
	const start = bleed + MARK_GAP;
	const end = start + MARK_LENGTH;

	function line(x1: number, y1: number, x2: number, y2: number): void {
		const el = doc.createElementNS(SVG_NS, "line");
		el.setAttribute("x1", String(x1));
		el.setAttribute("y1", String(y1));
		el.setAttribute("x2", String(x2));
		el.setAttribute("y2", String(y2));
		el.setAttribute("stroke", "black");
		el.setAttribute("stroke-width", "0.75");
		svg.append(el);
	}

	if (marks.crop) {
		// horizontal lines at each corner
		line(left - start, top, left - end, top);
		line(right + start, top, right + end, top);
		line(left - start, bottom, left - end, bottom);
		line(right + start, bottom, right + end, bottom);
		// vertical lines at each corner
		line(left, top - start, left, top - end);
		line(right, top - start, right, top - end);
		line(left, bottom + start, left, bottom + end);
		line(right, bottom + start, right, bottom + end);
	}

	if (marks.cross) {
		const radius = MARK_LENGTH / 3;
		const centers: [number, number][] = [
			[(left + right) / 2, top - start - radius],
			[(left + right) / 2, bottom + start + radius],
			[left - start - radius, (top + bottom) / 2],
			[right + start + radius, (top + bottom) / 2],
		];

		for (const [cx, cy] of centers) {
			const circle = doc.createElementNS(SVG_NS, "circle");
			circle.setAttribute("cx", String(cx));
			circle.setAttribute("cy", String(cy));
			circle.setAttribute("r", String(radius / 1.5));
			circle.setAttribute("fill", "none");
			circle.setAttribute("stroke", "black");
			circle.setAttribute("stroke-width", "0.75");
			svg.append(circle);
			line(cx - radius, cy, cx + radius, cy);
			line(cx, cy - radius, cx, cy + radius);
		}
	}

	return svg;
}

//-----------------------------------------------------------------------------
// Margin Boxes
//-----------------------------------------------------------------------------

interface PreparedBox {
	name: MarginBoxName;
	element: HTMLElement;
	generated: boolean;
	/** Specified size along the group's main axis. */
	size?: number;
	/** Specified size along the cross axis (the margin thickness). */
	crossSize?: number;
}

/**
 * Resolves a length or percentage margin box dimension.
 * @param value The component value.
 * @param reference The size percentages refer to.
 * @param fontSize The font size for em units.
 * @returns The resolved size, or undefined for auto/invalid.
 */
function resolveDimension(
	value: ComponentValue | undefined,
	reference: number,
	fontSize: number,
): number | undefined {
	if (!value) {
		return undefined;
	}

	if (isToken(value, "percentage")) {
		return (value.number! / 100) * reference;
	}

	return parseLength(value, fontSize);
}

const VERTICAL_ALIGN_TO_FLEX: Record<string, string> = {
	top: "flex-start",
	middle: "center",
	bottom: "flex-end",
};

/**
 * Renders the margin boxes of a page.
 * @param page The page box.
 * @param contentContext The context used to evaluate the boxes' content.
 * @param fontSize The font size for em units.
 */
export function renderMarginBoxes(
	page: PageBox,
	contentContext: ContentContext,
	fontSize = 16,
): void {
	const doc = page.element.ownerDocument;
	const { margins } = page.style;
	const { width, height } = page.geometry;
	const areaWidth = Math.max(0, width - margins.left - margins.right);
	const areaHeight = Math.max(0, height - margins.top - margins.bottom);
	const boxes = new Map<MarginBoxName, PreparedBox>();

	// Remove any previously rendered boxes.
	for (const old of page.trim.querySelectorAll(
		":scope > .pm-margin-box, :scope > .pm-margin-row, :scope > .pm-margin-column",
	)) {
		old.remove();
	}

	for (const name of MARGIN_BOX_NAMES) {
		const declarations = page.style.marginBoxes.get(name) ?? [];
		const box = doc.createElement("div");
		box.className = `pm-margin-box pm-${name}`;
		let generated = false;
		let size: number | undefined;
		let contentItems: ContentItem[] | undefined;

		for (const declaration of declarations) {
			if (declaration.name === "content") {
				const content = parseContent(declaration.value);

				if (content?.type === "list") {
					contentItems = content.items;
					generated = true;
				} else {
					contentItems = undefined;
					generated = false;
				}
			}
		}

		const isHorizontal =
			name.startsWith("top") || name.startsWith("bottom");
		const isCorner = name.endsWith("-corner");
		const sizeProperty = isHorizontal ? "width" : "height";
		const crossProperty = isHorizontal ? "height" : "width";
		const mainReference = isHorizontal ? areaWidth : areaHeight;
		let crossReference: number;

		if (isHorizontal) {
			crossReference = name.startsWith("top")
				? margins.top
				: margins.bottom;
		} else {
			crossReference = name.startsWith("left")
				? margins.left
				: margins.right;
		}

		let crossSize: number | undefined;

		for (const declaration of declarations) {
			if (declaration.name === sizeProperty && !isCorner) {
				const parsed = resolveDimension(
					declaration.value[0],
					mainReference,
					fontSize,
				);

				if (parsed !== undefined) {
					size = parsed;
				}
			}

			if (declaration.name === crossProperty && !isCorner) {
				const parsed = resolveDimension(
					declaration.value[0],
					crossReference,
					fontSize,
				);

				if (parsed !== undefined) {
					crossSize = parsed;
				}
			}

			if (declaration.name === "vertical-align") {
				const keyword = serialize(declaration.value)
					.trim()
					.toLowerCase();
				box.style.alignItems =
					VERTICAL_ALIGN_TO_FLEX[keyword] ?? "center";
			}
		}

		const inlineStyle = declarationsToStyle(
			declarations,
			new Set([
				"content",
				"vertical-align",
				"width",
				"height",
				"position",
				"float",
			]),
		);

		if (inlineStyle) {
			box.style.cssText += `;${inlineStyle}`;
		}

		if (generated && contentItems) {
			const wrapper = doc.createElement("div");
			wrapper.className = "pm-margin-content";
			wrapper.append(...evaluateToNodes(contentItems, contentContext));
			box.append(wrapper);
		} else {
			box.style.visibility = "hidden";
			box.setAttribute("data-pm-empty", "");
		}

		boxes.set(name, { name, element: box, generated, size, crossSize });
	}

	// Corners are fixed by the page margins.
	placeFixed(boxes.get("top-left-corner")!, 0, 0, margins.left, margins.top);
	placeFixed(
		boxes.get("top-right-corner")!,
		width - margins.right,
		0,
		margins.right,
		margins.top,
	);
	placeFixed(
		boxes.get("bottom-left-corner")!,
		0,
		height - margins.bottom,
		margins.left,
		margins.bottom,
	);
	placeFixed(
		boxes.get("bottom-right-corner")!,
		width - margins.right,
		height - margins.bottom,
		margins.right,
		margins.bottom,
	);

	for (const name of [
		"top-left-corner",
		"top-right-corner",
		"bottom-left-corner",
		"bottom-right-corner",
	] as const) {
		page.trim.append(boxes.get(name)!.element);
	}

	// Rows and columns share the available size per the spec's algorithm.
	layoutGroup(
		doc,
		page.trim,
		[
			boxes.get("top-left")!,
			boxes.get("top-center")!,
			boxes.get("top-right")!,
		],
		{ left: margins.left, top: 0, width: areaWidth, height: margins.top },
		true,
	);
	layoutGroup(
		doc,
		page.trim,
		[
			boxes.get("bottom-left")!,
			boxes.get("bottom-center")!,
			boxes.get("bottom-right")!,
		],
		{
			left: margins.left,
			top: height - margins.bottom,
			width: areaWidth,
			height: margins.bottom,
		},
		true,
	);
	layoutGroup(
		doc,
		page.trim,
		[
			boxes.get("left-top")!,
			boxes.get("left-middle")!,
			boxes.get("left-bottom")!,
		],
		{ left: 0, top: margins.top, width: margins.left, height: areaHeight },
		false,
	);
	layoutGroup(
		doc,
		page.trim,
		[
			boxes.get("right-top")!,
			boxes.get("right-middle")!,
			boxes.get("right-bottom")!,
		],
		{
			left: width - margins.right,
			top: margins.top,
			width: margins.right,
			height: areaHeight,
		},
		false,
	);
}

function placeFixed(
	box: PreparedBox,
	left: number,
	top: number,
	width: number,
	height: number,
): void {
	box.element.style.left = px(left);
	box.element.style.top = px(top);
	box.element.style.width = px(width);
	box.element.style.height = px(height);
}

function layoutGroup(
	doc: Document,
	parent: HTMLElement,
	group: [PreparedBox, PreparedBox, PreparedBox],
	rect: { left: number; top: number; width: number; height: number },
	horizontal: boolean,
): void {
	const container = doc.createElement("div");
	container.className = horizontal ? "pm-margin-row" : "pm-margin-column";
	container.style.left = px(rect.left);
	container.style.top = px(rect.top);
	container.style.width = px(rect.width);
	container.style.height = px(rect.height);

	for (const box of group) {
		const cross = box.crossSize ?? (horizontal ? rect.height : rect.width);

		if (horizontal) {
			box.element.style.height = px(cross);
		} else {
			box.element.style.width = px(cross);
		}

		container.append(box.element);
	}

	parent.append(container);

	const available = horizontal ? rect.width : rect.height;
	const measures = group.map(box => measureBox(box, horizontal)) as [
		MarginBoxMeasure,
		MarginBoxMeasure,
		MarginBoxMeasure,
	];
	const sizes = computeMarginBoxSizes(measures, available);

	group.forEach((box, index) => {
		const size = sizes[index];

		if (horizontal) {
			box.element.style.width = px(size);
		} else {
			box.element.style.height = px(size);
		}
	});
}

function measureBox(box: PreparedBox, horizontal: boolean): MarginBoxMeasure {
	if (!box.generated) {
		return { generated: false, maxContent: 0, minContent: 0 };
	}

	const { element } = box;
	const property = horizontal ? "width" : "height";
	const previous = element.style.getPropertyValue(property);

	element.style.setProperty(property, "max-content");
	const maxContent = horizontal ? element.offsetWidth : element.offsetHeight;
	element.style.setProperty(property, "min-content");
	const minContent = horizontal ? element.offsetWidth : element.offsetHeight;
	element.style.setProperty(property, previous);

	return {
		generated: true,
		size: box.size,
		maxContent: Math.ceil(maxContent),
		minContent: Math.ceil(minContent),
	};
}
