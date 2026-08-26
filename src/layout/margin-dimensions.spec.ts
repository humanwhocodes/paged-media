/**
 * @fileoverview Tests for the margin box dimension algorithm.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
	computeMarginBoxSizes,
	type MarginBoxMeasure,
} from "./margin-dimensions.js";

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

function box(
	maxContent: number,
	minContent = maxContent / 2,
	size?: number,
): MarginBoxMeasure {
	return { generated: true, maxContent, minContent, size };
}

//-----------------------------------------------------------------------------
// Tests
//-----------------------------------------------------------------------------

describe("computeMarginBoxSizes()", () => {
	it("should throw for invalid available size", () => {
		expect(() =>
			computeMarginBoxSizes(
				[undefined, undefined, undefined],
				Number.NaN,
			),
		).toThrow("Expected a numeric available size.");
	});

	it("should return zeros when no box is generated", () => {
		expect(
			computeMarginBoxSizes([undefined, undefined, undefined], 300),
		).toEqual([0, 0, 0]);
	});

	it("should give a lone side box the whole width", () => {
		expect(
			computeMarginBoxSizes([box(50), undefined, undefined], 300),
		).toEqual([300, 0, 0]);
		expect(
			computeMarginBoxSizes([undefined, undefined, box(50)], 300),
		).toEqual([0, 0, 300]);
	});

	it("should distribute extra space proportionally to max-content widths", () => {
		// 100 + 200 = 300 <= 400: flex space 100, factors 100:200
		const sizes = computeMarginBoxSizes(
			[box(100), undefined, box(200)],
			400,
		);
		expect(sizes[0]).toBeCloseTo(100 + 100 / 3);
		expect(sizes[2]).toBeCloseTo(200 + 200 / 3);
		expect(sizes[1]).toBe(0);
	});

	it("should shrink between min and max content when max-content overflows", () => {
		// max 300+300=600 > 400; min 100+100=200 <= 400: space 200, factors 200:200
		expect(
			computeMarginBoxSizes(
				[box(300, 100), undefined, box(300, 100)],
				400,
			),
		).toEqual([200, 0, 200]);
	});

	it("should shrink below min-content proportionally when even min-content overflows", () => {
		// min 300+100=400 > 200: space -200, factors 300:100
		const sizes = computeMarginBoxSizes(
			[box(400, 300), undefined, box(200, 100)],
			200,
		);
		expect(sizes[0]).toBeCloseTo(300 - 150);
		expect(sizes[2]).toBeCloseTo(100 - 50);
	});

	it("should use equal factors when both are zero", () => {
		expect(
			computeMarginBoxSizes([box(0, 0), undefined, box(0, 0)], 100),
		).toEqual([50, 0, 50]);
	});

	it("should honor fixed widths on side boxes", () => {
		expect(
			computeMarginBoxSizes([box(10, 5, 120), undefined, box(50)], 300),
		).toEqual([120, 0, 180]);
		expect(
			computeMarginBoxSizes([box(10), undefined, box(50, 25, 100)], 300),
		).toEqual([200, 0, 100]);
	});

	it("should center the middle box and split the remainder", () => {
		// B max 100, AC max 2*max(60, 40)=120 → 220 <= 400 → flex space 180 split 100:120
		const sizes = computeMarginBoxSizes([box(60), box(100), box(40)], 400);
		const expectedB = 100 + (180 * 100) / 220;
		expect(sizes[1]).toBeCloseTo(expectedB);
		expect(sizes[0]).toBeCloseTo((400 - expectedB) / 2);
		expect(sizes[2]).toBeCloseTo((400 - expectedB) / 2);
	});

	it("should center a lone middle box", () => {
		const sizes = computeMarginBoxSizes(
			[undefined, box(100), undefined],
			400,
		);
		expect(sizes).toEqual([0, 400, 0]);
	});

	it("should honor a fixed width on the middle box", () => {
		expect(
			computeMarginBoxSizes([box(10), box(50, 25, 100), box(10)], 400),
		).toEqual([150, 100, 150]);
	});
});
