/**
 * @fileoverview Runtime detection of native CSS paged media support.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

/**
 * The set of paged media features the polyfill knows about. Each key maps to
 * whether the current browser supports the feature natively.
 */
export interface SupportReport {
	/** `@page { size: ... }` */
	pageSize: boolean;
	/** `@page :first`, `:left`, `:right` */
	pageSelectors: boolean;
	/**
	 * `@page :blank`. Firefox parses the selector without implementing the
	 * rendering, so it cannot be detected by parsing; assumed unsupported.
	 */
	blankPages: boolean;
	/** `@page :nth()` */
	nthPages: boolean;
	/** Named pages via the `page` property. */
	namedPages: boolean;
	/** `@top-center` and friends. */
	marginBoxes: boolean;
	/** `counter(page)` and `counter(pages)` in margin boxes. */
	pageCounters: boolean;
	/**
	 * `counter(page)` and `counter(pages)` in flow content (e.g. `::after`).
	 * Cannot be feature-detected at runtime; assumed unsupported.
	 */
	pageCountersInFlow: boolean;
	/** `marks` descriptor. */
	marks: boolean;
	/** `bleed` descriptor. */
	bleed: boolean;
	/** `string-set` and `string()`. */
	namedStrings: boolean;
	/** `position: running()` and `element()`. */
	runningElements: boolean;
	/** `float: footnote`. */
	footnotes: boolean;
	/** `target-counter()` and `target-text()`. */
	crossReferences: boolean;
	/** `leader()`. */
	leaders: boolean;
	/**
	 * `break-before: left | right | recto | verso` producing blank pages.
	 * Cannot be feature-detected at runtime; assumed unsupported.
	 */
	leftRightBreaks: boolean;
	/** `orphans` and `widows` (not implemented by Firefox). */
	orphansWidows: boolean;
	/** `bookmark-level` and friends. */
	bookmarks: boolean;
}

export type FeatureName = keyof SupportReport;

//-----------------------------------------------------------------------------
// Detection
//-----------------------------------------------------------------------------

function supports(property: string, value: string): boolean {
	try {
		return typeof CSS !== "undefined" && CSS.supports(property, value);
	} catch {
		return false;
	}
}

/**
 * Parses CSS and returns the rule text of the first rule, or an empty string
 * if the CSS could not be parsed into a rule.
 * @param css The CSS text.
 * @returns The first rule's cssText.
 */
function parsedRuleText(css: string): string {
	if (typeof document === "undefined") {
		return "";
	}

	const style = document.createElement("style");
	style.textContent = css;
	document.head.append(style);

	try {
		const rule = style.sheet?.cssRules[0];
		return rule ? rule.cssText : "";
	} catch {
		return "";
	} finally {
		style.remove();
	}
}

function pageRuleKeeps(css: string, needle: string): boolean {
	return parsedRuleText(css).includes(needle);
}

/**
 * Detects native support for paged media features in the current browser.
 * @returns The support report.
 */
export function detectSupport(): SupportReport {
	return {
		pageSize: pageRuleKeeps("@page { size: A4; }", "size"),
		pageSelectors:
			pageRuleKeeps("@page :first { margin: 1in; }", ":first") &&
			pageRuleKeeps("@page :left { margin: 1in; }", ":left"),
		blankPages: false,
		nthPages: pageRuleKeeps("@page :nth(2) { margin: 1in; }", ":nth"),
		namedPages:
			supports("page", "chapter") &&
			pageRuleKeeps("@page chapter { margin: 1in; }", "chapter"),
		marginBoxes: pageRuleKeeps(
			'@page { @top-center { content: "x"; } }',
			"@top-center",
		),
		pageCounters:
			supports("content", "counter(page)") &&
			pageRuleKeeps(
				"@page { @top-center { content: counter(page); } }",
				"counter(page)",
			),
		pageCountersInFlow: false,
		marks: pageRuleKeeps("@page { marks: crop; }", "marks"),
		bleed: pageRuleKeeps("@page { bleed: 6pt; }", "bleed"),
		namedStrings:
			supports("string-set", "title content(text)") &&
			supports("content", "string(title)"),
		runningElements:
			supports("position", "running(header)") &&
			supports("content", "element(header)"),
		footnotes: supports("float", "footnote"),
		// Chromium parses target-counter() but does not render it.
		crossReferences: false,
		leaders: supports("content", "leader(dotted)"),
		leftRightBreaks: false,
		orphansWidows: supports("orphans", "2") && supports("widows", "2"),
		bookmarks: supports("bookmark-level", "1"),
	};
}
