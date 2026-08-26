/**
 * @fileoverview Tests for the named string / running element store.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { AssignmentStore } from "./strings.js";

//-----------------------------------------------------------------------------
// Tests
//-----------------------------------------------------------------------------

describe("AssignmentStore", () => {
	function createStore(): AssignmentStore<string> {
		const store = new AssignmentStore<string>();
		store.add("title", { page: 0, value: "A", atPageStart: true });
		store.add("title", { page: 2, value: "B", atPageStart: false });
		store.add("title", { page: 2, value: "C", atPageStart: false });
		store.add("title", { page: 4, value: "D", atPageStart: true });
		return store;
	}

	it("should throw for invalid names", () => {
		const store = new AssignmentStore<string>();
		expect(() =>
			store.add("", { page: 0, value: "x", atPageStart: true }),
		).toThrow("Expected a non-empty string name.");
	});

	it("should resolve first", () => {
		const store = createStore();
		expect(store.resolve("title", 0, "first")).toBe("A");
		expect(store.resolve("title", 1, "first")).toBe("A");
		expect(store.resolve("title", 2, "first")).toBe("B");
		expect(store.resolve("title", 3, "first")).toBe("C");
		expect(store.resolve("title", 4, "first")).toBe("D");
	});

	it("should resolve start", () => {
		const store = createStore();
		expect(store.resolve("title", 0, "start")).toBe("A");
		expect(store.resolve("title", 2, "start")).toBe("A");
		expect(store.resolve("title", 3, "start")).toBe("C");
		expect(store.resolve("title", 4, "start")).toBe("D");
	});

	it("should resolve last", () => {
		const store = createStore();
		expect(store.resolve("title", 2, "last")).toBe("C");
		expect(store.resolve("title", 3, "last")).toBe("C");
		expect(store.resolve("title", 1, "last")).toBe("A");
	});

	it("should resolve first-except", () => {
		const store = createStore();
		expect(store.resolve("title", 0, "first-except")).toBeUndefined();
		expect(store.resolve("title", 1, "first-except")).toBe("A");
		expect(store.resolve("title", 2, "first-except")).toBeUndefined();
		expect(store.resolve("title", 3, "first-except")).toBe("C");
	});

	it("should return undefined for unknown names or before any assignment", () => {
		const store = new AssignmentStore<string>();
		store.add("title", { page: 3, value: "X", atPageStart: false });
		expect(store.resolve("other", 0, "first")).toBeUndefined();
		expect(store.resolve("title", 1, "first")).toBeUndefined();
		expect(store.names()).toEqual(["title"]);
	});

	it("should throw for unknown assignment keywords", () => {
		const store = createStore();
		// @ts-expect-error testing invalid input
		expect(() => store.resolve("title", 0, "bogus")).toThrow(
			"Unknown assignment keyword: bogus.",
		);
	});

	it("should roll back assignments on or after a page", () => {
		const store = createStore();
		store.rollback(2);
		expect(store.resolve("title", 4, "first")).toBe("A");
		store.rollback(0, entry => entry.value === "A");
		expect(store.resolve("title", 4, "first")).toBe("A");
	});
});
