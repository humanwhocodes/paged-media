/**
 * @fileoverview Bookkeeping for named strings (`string-set`/`string()`) and
 * running elements (`position: running()`/`element()`).
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import type { StringAssignment } from "../css/values.js";

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

export interface Assignment<T> {
	/** 0-based page index where the assignment happened. */
	page: number;
	/** The assigned value. */
	value: T;
	/** Whether the assignment happened at the very start of the page. */
	atPageStart: boolean;
}

//-----------------------------------------------------------------------------
// Assignment Store
//-----------------------------------------------------------------------------

/**
 * Stores assignments of named values in document order and resolves the
 * value to use for a page according to the `string()`/`element()` keywords.
 */
export class AssignmentStore<T> {
	#assignments = new Map<string, Assignment<T>[]>();

	/**
	 * Records an assignment.
	 * @param name The name being assigned.
	 * @param assignment The assignment.
	 */
	add(name: string, assignment: Assignment<T>): void {
		if (typeof name !== "string" || !name) {
			throw new TypeError("Expected a non-empty string name.");
		}

		const list = this.#assignments.get(name) ?? [];
		list.push(assignment);
		this.#assignments.set(name, list);
	}

	/**
	 * Removes all assignments on or after the given page (used when a page
	 * is re-laid out).
	 * @param page The page index.
	 * @param keep An optional predicate returning true for assignments to keep.
	 */
	rollback(
		page: number,
		keep?: (assignment: Assignment<T>) => boolean,
	): void {
		for (const [name, list] of this.#assignments) {
			this.#assignments.set(
				name,
				list.filter(
					entry => entry.page < page || (keep?.(entry) ?? false),
				),
			);
		}
	}

	/**
	 * Returns the names that have at least one assignment.
	 * @returns The names.
	 */
	names(): string[] {
		return [...this.#assignments.keys()];
	}

	/**
	 * Resolves the value of a name for a page.
	 * @param name The name.
	 * @param page The 0-based page index.
	 * @param assignment The assignment keyword.
	 * @returns The value, or undefined if there is none.
	 */
	resolve(
		name: string,
		page: number,
		assignment: StringAssignment,
	): T | undefined {
		const list = this.#assignments.get(name) ?? [];
		let entry: T | undefined;
		let first: Assignment<T> | undefined;
		let last: Assignment<T> | undefined;

		for (const item of list) {
			if (item.page < page) {
				entry = item.value;
			} else if (item.page === page) {
				if (!first) {
					first = item;
				}

				last = item;
			} else {
				break;
			}
		}

		switch (assignment) {
			case "first":
				return first ? first.value : entry;
			case "start":
				return first && first.atPageStart ? first.value : entry;
			case "last":
				return last ? last.value : entry;
			case "first-except":
				return first ? undefined : entry;
			default:
				throw new TypeError(
					`Unknown assignment keyword: ${assignment}.`,
				);
		}
	}
}
