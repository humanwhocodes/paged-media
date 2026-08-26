/**
 * @fileoverview Implements the variable dimension computation rules for
 * page-margin boxes from CSS Paged Media Level 3, section 5.3.2.2.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

export interface MarginBoxMeasure {
	/** Whether the box is generated (has content). */
	generated: boolean;
	/** The specified outer size, or undefined for `auto`. */
	size?: number;
	/** The max-content outer size. */
	maxContent: number;
	/** The min-content outer size. */
	minContent: number;
}

//-----------------------------------------------------------------------------
// Algorithm
//-----------------------------------------------------------------------------

function empty(): MarginBoxMeasure {
	return { generated: false, maxContent: 0, minContent: 0 };
}

/**
 * Distributes the available size between two boxes per the flex rules.
 * @param a The first box.
 * @param c The second box.
 * @param available The available size.
 * @returns The sizes of the two boxes.
 */
function distributeTwo(
	a: MarginBoxMeasure,
	c: MarginBoxMeasure,
	available: number,
): [number, number] {
	const aAuto = a.size === undefined;
	const cAuto = c.size === undefined;

	if (!aAuto && !cAuto) {
		return [a.size!, c.size!];
	}

	if (!aAuto) {
		return [a.size!, Math.max(0, available - a.size!)];
	}

	if (!cAuto) {
		return [Math.max(0, available - c.size!), c.size!];
	}

	// Both auto: apply the flex algorithm.
	let flexSpace: number;
	let factorA: number;
	let factorC: number;
	let baseA: number;
	let baseC: number;

	if (a.maxContent + c.maxContent <= available) {
		flexSpace = available - (a.maxContent + c.maxContent);
		factorA = a.maxContent;
		factorC = c.maxContent;
		baseA = a.maxContent;
		baseC = c.maxContent;
	} else if (a.minContent + c.minContent <= available) {
		flexSpace = available - (a.minContent + c.minContent);
		factorA = a.maxContent - a.minContent;
		factorC = c.maxContent - c.minContent;
		baseA = a.minContent;
		baseC = c.minContent;
	} else {
		flexSpace = available - (a.minContent + c.minContent);
		factorA = a.minContent;
		factorC = c.minContent;
		baseA = a.minContent;
		baseC = c.minContent;
	}

	let sum = factorA + factorC;

	if (sum === 0) {
		factorA = 1;
		factorC = 1;
		sum = 2;
	}

	return [
		Math.max(0, baseA + (flexSpace * factorA) / sum),
		Math.max(0, baseC + (flexSpace * factorC) / sum),
	];
}

/**
 * Computes the sizes of the three boxes that share a page-margin area
 * (e.g. top-left, top-center, top-right) along the area's main axis.
 * @param boxes The three boxes in order (A, B, C) where B is the center box.
 * @param available The available size along the axis.
 * @returns The sizes of the three boxes.
 */
export function computeMarginBoxSizes(
	boxes: [
		MarginBoxMeasure | undefined,
		MarginBoxMeasure | undefined,
		MarginBoxMeasure | undefined,
	],
	available: number,
): [number, number, number] {
	if (typeof available !== "number" || Number.isNaN(available)) {
		throw new TypeError("Expected a numeric available size.");
	}

	const a = boxes[0] ?? empty();
	const b = boxes[1] ?? empty();
	const c = boxes[2] ?? empty();

	if (!b.generated) {
		const aBox = a.generated ? a : { ...empty(), size: 0 };
		const cBox = c.generated ? c : { ...empty(), size: 0 };

		if (!a.generated && !c.generated) {
			return [0, 0, 0];
		}

		const [sizeA, sizeC] = distributeTwo(aBox, cBox, available);
		return [sizeA, 0, sizeC];
	}

	// B is generated: pair it with an imaginary box AC whose dimensions are
	// double the maximum of A and C.
	const ac: MarginBoxMeasure = {
		generated: true,
		maxContent: 2 * Math.max(a.maxContent, c.maxContent),
		minContent: 2 * Math.max(a.minContent, c.minContent),
	};

	if (a.size !== undefined || c.size !== undefined) {
		ac.size = 2 * Math.max(a.size ?? 0, c.size ?? 0);
	}

	const [sizeB] = distributeTwo(b, ac, available);
	const side = Math.max(0, (available - sizeB) / 2);
	return [side, sizeB, side];
}
