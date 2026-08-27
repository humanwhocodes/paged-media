/**
 * @fileoverview Computes CSS counter values for elements so that
 * `target-counter()` and `target-counters()` can be resolved.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

export interface CounterInstance {
	name: string;
	value: number;
	/** The element whose end closes this counter's scope. */
	scopeEnd: Node | null;
	/** The element that created the counter (its originating element). */
	creator: Element;
}

/** Counter values visible at an element, keyed by counter name (outermost first). */
export type CounterValues = Map<string, number[]>;

/**
 * The counter instances that are open at different points around an
 * element (outermost first).
 */
export interface CounterStates {
	/** Before the element's own counter properties are applied. */
	before: CounterInstance[];
	/** After the element's own counter properties, before its children. */
	inside: CounterInstance[];
	/** After the element and its descendants (their scopes closed). */
	after: CounterInstance[];
}

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

/**
 * Parses a computed `counter-reset`/`counter-increment`/`counter-set` value.
 * @param value The computed value (e.g. "chapter 1 section 0" or "none").
 * @param defaultAmount The amount used when omitted.
 * @returns The list of counter names and amounts.
 */
export function parseCounterValue(
	value: string,
	defaultAmount: number,
): [string, number][] {
	const trimmed = value.trim();

	if (!trimmed || trimmed === "none") {
		return [];
	}

	const parts = trimmed.split(/\s+/);
	const result: [string, number][] = [];
	let index = 0;

	while (index < parts.length) {
		const name = parts[index++];
		let amount = defaultAmount;

		if (index < parts.length && /^[+-]?\d+$/.test(parts[index])) {
			amount = Number(parts[index++]);
		}

		result.push([name, amount]);
	}

	return result;
}

//-----------------------------------------------------------------------------
// Counter Engine
//-----------------------------------------------------------------------------

/**
 * Computes the counter values visible at every element in a subtree,
 * following the CSS 2.1 counter scoping rules.
 * @param root The root element.
 * @param getStyle A function returning the computed style for an element.
 * @returns A map from element to its visible counter values.
 */
export function computeCounters(
	root: Element,
	getStyle: CounterStyleGetter = defaultCounterStyle,
): Map<Element, CounterValues> {
	const result = new Map<Element, CounterValues>();

	for (const [element, states] of computeCounterStates(root, getStyle)) {
		result.set(element, toCounterValues(states.inside));
	}

	return result;
}

/**
 * Converts counter instances to the values visible at an element.
 * @param instances The open counter instances.
 * @returns The values keyed by counter name.
 */
export function toCounterValues(instances: CounterInstance[]): CounterValues {
	const values: CounterValues = new Map();

	for (const instance of instances) {
		const list = values.get(instance.name) ?? [];
		list.push(instance.value);
		values.set(instance.name, list);
	}

	return values;
}

/**
 * Returns the counter instances open just before a node, i.e. the state a
 * page must recreate when it starts at that node.
 * @param states The computed counter states.
 * @param node The node.
 * @returns The instances, or undefined if the node is unknown.
 */
export function counterStateBefore(
	states: Map<Element, CounterStates>,
	node: Node,
): CounterInstance[] | undefined {
	if (node.nodeType === 1) {
		return states.get(node as Element)?.before;
	}

	let previous = node.previousSibling;

	while (previous) {
		if (previous.nodeType === 1) {
			return states.get(previous as Element)?.after;
		}

		previous = previous.previousSibling;
	}

	const parent = node.parentElement;
	return parent ? states.get(parent)?.inside : undefined;
}

/**
 * Returns the computed style of an element or one of its pseudo-elements.
 * For a pseudo-element, undefined is returned when it is not generated
 * (its `content` is `none` or `normal`), since it then has no effect on
 * counters.
 */
export type CounterStyleGetter = (
	element: Element,
	pseudo?: "::before" | "::after",
) => CSSStyleDeclaration | undefined;

/**
 * The default style getter, which uses the global `getComputedStyle()`.
 * @param element The element.
 * @param pseudo The pseudo-element, if any.
 * @returns The computed style.
 */
export function defaultCounterStyle(
	element: Element,
	pseudo?: "::before" | "::after",
): CSSStyleDeclaration | undefined {
	const style = getComputedStyle(element, pseudo);

	if (pseudo && (style.content === "none" || style.content === "normal")) {
		return undefined;
	}

	return style;
}

/**
 * Computes the open counter instances before, inside, and after every
 * element in a subtree, following the CSS 2.1 counter scoping rules.
 * Counter properties on `::before` and `::after` pseudo-elements are
 * applied when the style getter returns a style for them.
 * @param root The root element.
 * @param getStyle A function returning the computed style for an element
 *      (or pseudo-element).
 * @returns A map from element to its counter states.
 */
export function computeCounterStates(
	root: Element,
	getStyle: CounterStyleGetter = defaultCounterStyle,
): Map<Element, CounterStates> {
	if (!root || root.nodeType !== 1) {
		throw new TypeError("Expected an element argument.");
	}

	const result = new Map<Element, CounterStates>();
	const instances: CounterInstance[] = [];

	function snapshot(): CounterInstance[] {
		return instances.map(instance => ({ ...instance }));
	}

	function innermost(name: string): CounterInstance | undefined {
		for (let i = instances.length - 1; i >= 0; i--) {
			if (instances[i].name === name) {
				return instances[i];
			}
		}

		return undefined;
	}

	/**
	 * Applies the counter properties of a style (of an element or a
	 * pseudo-element) to the open instances.
	 * @param style The computed style.
	 * @param scopeEnd The node whose end closes counters created here.
	 */
	function apply(
		style: CSSStyleDeclaration,
		creator: Element,
		scopeEnd: Node | null,
	): void {
		for (const [name, amount] of parseCounterValue(style.counterReset, 0)) {
			// A counter created by a previous sibling (whose scope ends at
			// the same node) is replaced rather than nested.
			const existing = innermost(name);

			if (existing && existing.scopeEnd === scopeEnd) {
				instances.splice(instances.indexOf(existing), 1);
			}

			instances.push({ name, value: amount, scopeEnd, creator });
		}

		for (const [name, amount] of parseCounterValue(
			style.counterSet ?? "none",
			0,
		)) {
			const instance = innermost(name);

			if (instance) {
				instance.value = amount;
			} else {
				instances.push({ name, value: amount, scopeEnd, creator });
			}
		}

		for (const [name, amount] of parseCounterValue(
			style.counterIncrement,
			1,
		)) {
			const instance = innermost(name);

			if (instance) {
				instance.value += amount;
			} else {
				instances.push({ name, value: amount, scopeEnd, creator });
			}
		}
	}

	function visit(element: Element): void {
		const before = snapshot();
		const style = getStyle(element);

		if (style) {
			apply(style, element, element.parentNode);
		}

		// ::before acts like a first child.
		const beforeStyle = getStyle(element, "::before");

		if (beforeStyle) {
			apply(beforeStyle, element, element);
		}

		const states: CounterStates = {
			before,
			inside: snapshot(),
			after: [],
		};
		result.set(element, states);

		for (const child of element.children) {
			visit(child);
		}

		// ::after acts like a last child.
		const afterStyle = getStyle(element, "::after");

		if (afterStyle) {
			apply(afterStyle, element, element);
		}

		// Close scopes of counters created by descendants.
		for (let i = instances.length - 1; i >= 0; i--) {
			if (instances[i].scopeEnd === element) {
				instances.splice(i, 1);
			}
		}

		states.after = snapshot();
	}

	visit(root);
	return result;
}
