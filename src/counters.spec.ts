/**
 * @fileoverview Tests for the counter engine.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
	computeCounters,
	computeCounterStates,
	counterStateBefore,
	parseCounterValue,
	toCounterValues,
} from "./counters.js";

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

interface FakeStyle {
	counterReset?: string;
	counterIncrement?: string;
	counterSet?: string;
	before?: FakeStyle;
	after?: FakeStyle;
}

interface FakeNode {
	nodeType: number;
	parentNode: FakeNode | null;
	parentElement: FakeNode | null;
	previousSibling: FakeNode | null;
	children: FakeNode[];
	style: FakeStyle;
	name: string;
}

/**
 * Creates a minimal element-like node tree for the counter engine, which
 * only relies on `nodeType`, `children`, `parentNode`, `parentElement`,
 * and `previousSibling`.
 * @param name A name for debugging.
 * @param style The counter properties.
 * @param children The child nodes.
 * @returns The node.
 */
function el(
	name: string,
	style: FakeStyle = {},
	children: FakeNode[] = [],
): FakeNode {
	const node: FakeNode = {
		nodeType: 1,
		parentNode: null,
		parentElement: null,
		previousSibling: null,
		children,
		style,
		name,
	};

	children.forEach((child, index) => {
		child.parentNode = node;
		child.parentElement = node;
		child.previousSibling = index > 0 ? children[index - 1] : null;
	});

	return node;
}

function text(): FakeNode {
	return {
		nodeType: 3,
		parentNode: null,
		parentElement: null,
		previousSibling: null,
		children: [],
		style: {},
		name: "#text",
	};
}

function toStyle(
	style: FakeStyle | undefined,
): CSSStyleDeclaration | undefined {
	if (!style) {
		return undefined;
	}

	return {
		counterReset: style.counterReset ?? "none",
		counterIncrement: style.counterIncrement ?? "none",
		counterSet: style.counterSet ?? "none",
	} as CSSStyleDeclaration;
}

function getStyle(
	element: Element,
	pseudo?: "::before" | "::after",
): CSSStyleDeclaration | undefined {
	const { style } = element as unknown as FakeNode;

	if (pseudo === "::before") {
		return toStyle(style.before);
	}

	if (pseudo === "::after") {
		return toStyle(style.after);
	}

	return toStyle(style);
}

function values(
	map: Map<string, number[]> | undefined,
): Record<string, number[]> {
	return Object.fromEntries(map ?? []);
}

function asElement(node: FakeNode): Element {
	return node as unknown as Element;
}

//-----------------------------------------------------------------------------
// Tests
//-----------------------------------------------------------------------------

describe("parseCounterValue()", () => {
	it("should parse names with and without amounts", () => {
		expect(parseCounterValue("chapter 1 section", 0)).toEqual([
			["chapter", 1],
			["section", 0],
		]);
		expect(parseCounterValue("none", 1)).toEqual([]);
		expect(parseCounterValue("  ", 1)).toEqual([]);
		expect(parseCounterValue("item -2", 1)).toEqual([["item", -2]]);
	});
});

describe("computeCounterStates()", () => {
	it("should throw for a non-element root", () => {
		// @ts-expect-error testing invalid input
		expect(() => computeCounterStates(null)).toThrow(
			"Expected an element argument.",
		);
	});

	it("should record the states before, inside, and after each element", () => {
		const h2 = el("h2", { counterIncrement: "section" });
		const h1 = el("h1", {
			counterIncrement: "chapter",
			counterReset: "section",
		});
		const root = el("root", { counterReset: "chapter" }, [h1, h2]);
		const states = computeCounterStates(asElement(root), getStyle);

		expect(
			values(toCounterValues(states.get(asElement(h1))!.before)),
		).toEqual({
			chapter: [0],
		});
		expect(
			values(toCounterValues(states.get(asElement(h1))!.inside)),
		).toEqual({
			chapter: [1],
			section: [0],
		});
		expect(
			values(toCounterValues(states.get(asElement(h2))!.inside)),
		).toEqual({
			chapter: [1],
			section: [1],
		});
		expect(states.get(asElement(h2))!.inside[1]).toEqual({
			name: "section",
			value: 1,
			scopeEnd: root,
			creator: h1,
		});
		expect(
			values(toCounterValues(states.get(asElement(root))!.after)),
		).toEqual({ chapter: [1] });
	});

	it("should nest counters created in descendants", () => {
		const sub = el("li");
		const inner = el("ol", { counterReset: "item" }, [sub]);
		const first = el("li", { counterIncrement: "item" }, [inner]);
		const second = el("li", { counterIncrement: "item" });
		const outer = el("ol", { counterReset: "item" }, [first, second]);
		const root = el("root", {}, [outer]);
		const states = computeCounterStates(asElement(root), getStyle);

		expect(
			values(toCounterValues(states.get(asElement(inner))!.inside)),
		).toEqual({
			item: [1, 0],
		});
		expect(
			values(toCounterValues(states.get(asElement(second))!.inside)),
		).toEqual({
			item: [2],
		});
	});

	it("should apply counter properties of ::before and ::after", () => {
		const items = [
			el("li", { before: { counterIncrement: "item" } }),
			el("li", { before: { counterIncrement: "item" } }),
			el("li", {
				before: { counterIncrement: "item" },
				after: { counterIncrement: "item 10" },
			}),
			el("li", { before: { counterIncrement: "item" } }),
		];
		const list = el("ol", { counterReset: "item" }, items);
		const states = computeCounterStates(asElement(list), getStyle);

		expect(
			values(toCounterValues(states.get(asElement(items[1]))!.before)),
		).toEqual({
			item: [1],
		});
		expect(
			values(toCounterValues(states.get(asElement(items[1]))!.inside)),
		).toEqual({
			item: [2],
		});
		expect(
			values(toCounterValues(states.get(asElement(items[3]))!.inside)),
		).toEqual({
			item: [14],
		});
	});

	it("should replace a sibling's counter and honor counter-set", () => {
		const a = el("p", { counterReset: "n 5" });
		const b = el("p", { counterReset: "n" });
		const c = el("p", { counterSet: "n 9" });
		const d = el("p", { counterSet: "other 3" });
		const root = el("root", {}, [a, b, c, d]);
		const states = computeCounterStates(asElement(root), getStyle);

		expect(
			values(toCounterValues(states.get(asElement(b))!.inside)),
		).toEqual({
			n: [0],
		});
		expect(
			values(toCounterValues(states.get(asElement(c))!.inside)),
		).toEqual({
			n: [9],
		});
		expect(
			values(toCounterValues(states.get(asElement(d))!.inside)),
		).toEqual({
			n: [9],
			other: [3],
		});
	});
});

describe("counterStateBefore()", () => {
	it("should return the state before an element or text node", () => {
		const t1 = text();
		const p = el("p", { counterIncrement: "n" });
		const t2 = text();
		const div = el("div", { counterReset: "n 4" }, [t1, p, t2]);
		const root = el("root", {}, [div]);
		const states = computeCounterStates(asElement(root), getStyle);

		expect(
			values(toCounterValues(counterStateBefore(states, asElement(p))!)),
		).toEqual({
			n: [4],
		});
		expect(
			values(toCounterValues(counterStateBefore(states, asElement(t1))!)),
		).toEqual({
			n: [4],
		});
		expect(
			values(toCounterValues(counterStateBefore(states, asElement(t2))!)),
		).toEqual({
			n: [5],
		});
		expect(counterStateBefore(states, asElement(el("x")))).toBeUndefined();
	});
});

describe("computeCounters()", () => {
	it("should return the values visible inside each element", () => {
		const h2 = el("h2", { counterIncrement: "section" });
		const root = el("root", { counterReset: "section 2" }, [h2]);
		const counters = computeCounters(asElement(root), getStyle);

		expect(values(counters.get(asElement(h2)))).toEqual({ section: [3] });
	});
});
