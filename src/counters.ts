/**
 * @fileoverview Computes CSS counter values for elements so that
 * `target-counter()` and `target-counters()` can be resolved.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

interface CounterInstance {
	name: string;
	value: number;
	/** The element whose end closes this counter's scope. */
	scopeEnd: Node | null;
}

/** Counter values visible at an element, keyed by counter name (outermost first). */
export type CounterValues = Map<string, number[]>;

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
	getStyle: (element: Element) => CSSStyleDeclaration = element =>
		getComputedStyle(element),
): Map<Element, CounterValues> {
	if (!root || root.nodeType !== 1) {
		throw new TypeError("Expected an element argument.");
	}

	const result = new Map<Element, CounterValues>();
	const instances: CounterInstance[] = [];

	function snapshot(): CounterValues {
		const values: CounterValues = new Map();

		for (const instance of instances) {
			const list = values.get(instance.name) ?? [];
			list.push(instance.value);
			values.set(instance.name, list);
		}

		return values;
	}

	function innermost(name: string): CounterInstance | undefined {
		for (let i = instances.length - 1; i >= 0; i--) {
			if (instances[i].name === name) {
				return instances[i];
			}
		}

		return undefined;
	}

	function visit(element: Element): void {
		const style = getStyle(element);

		for (const [name, amount] of parseCounterValue(style.counterReset, 0)) {
			// A counter created by a previous sibling (whose scope ends at
			// this element's parent) is replaced rather than nested.
			const existing = innermost(name);

			if (existing && existing.scopeEnd === element.parentNode) {
				instances.splice(instances.indexOf(existing), 1);
			}

			instances.push({
				name,
				value: amount,
				scopeEnd: element.parentNode,
			});
		}

		for (const [name, amount] of parseCounterValue(
			style.counterSet ?? "none",
			0,
		)) {
			const instance = innermost(name);

			if (instance) {
				instance.value = amount;
			} else {
				instances.push({
					name,
					value: amount,
					scopeEnd: element.parentNode,
				});
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
				instances.push({
					name,
					value: amount,
					scopeEnd: element.parentNode,
				});
			}
		}

		result.set(element, snapshot());

		for (const child of element.children) {
			visit(child);
		}

		// Close scopes of counters created by descendants.
		for (let i = instances.length - 1; i >= 0; i--) {
			if (instances[i].scopeEnd === element) {
				instances.splice(i, 1);
			}
		}
	}

	visit(root);
	return result;
}
