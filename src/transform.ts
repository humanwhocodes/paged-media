/**
 * @fileoverview Transforms author stylesheets so that the browser keeps the
 * information the polyfill needs: unsupported properties are rewritten into
 * registered custom properties, @page rules are extracted, and dynamic
 * content values are replaced by custom property references.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import {
	type AtRule,
	type Declaration,
	type Rule,
	type Stylesheet,
	isFunction,
	isIdent,
	parseComponentValues,
	serialize,
	serializeStylesheet,
	withoutWhitespace,
} from "./css/parser.js";
import {
	type ContentValue,
	isDynamicContent,
	parseContent,
} from "./css/values.js";
import { type PageRule, createPageRule } from "./page-rules.js";
import type { FeatureName } from "./support.js";

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

export interface DynamicContentRule {
	/** Unique id used to build the custom property name. */
	id: number;
	/** The selector with the pseudo-element removed. */
	selector: string;
	/** The pseudo-element the content applies to ("before", "after", ...). */
	pseudo: string;
	content: ContentValue;
}

export interface TransformResult {
	/** The transformed CSS to apply natively. */
	css: string;
	pageRules: PageRule[];
	dynamicContent: DynamicContentRule[];
	/** The features used by the stylesheets. */
	features: Set<FeatureName>;
	/** Whether counter properties are set on `::before`/`::after` rules. */
	pseudoCounters: boolean;
}

export interface TransformOptions {
	/** Whether rules inside `@media print` should be applied unconditionally. */
	hoistPrint?: boolean;
}

//-----------------------------------------------------------------------------
// Constants
//-----------------------------------------------------------------------------

export const CUSTOM_PROPERTIES = {
	stringSet: "--pm-string-set",
	float: "--pm-float",
	running: "--pm-running",
	footnoteDisplay: "--pm-footnote-display",
	footnotePolicy: "--pm-footnote-policy",
	breakBefore: "--pm-break-before",
	breakAfter: "--pm-break-after",
	orphans: "--pm-orphans",
	widows: "--pm-widows",
	contentPrefix: "--pm-content-",
	leaderWidthPrefix: "--pm-leader-width-",
} as const;

const PSEUDO_ELEMENT_PATTERN =
	/(?:::?(before|after|marker)|>\s*\.pm-(footnote-call|footnote-marker))\s*$/i;
const LEFT_RIGHT_BREAKS = new Set(["left", "right", "recto", "verso"]);
/**
 * Matches `body >` in a selector. After pagination the content's direct
 * parent is the hidden source container or a page's body box, so child
 * combinators on `body` are widened to those containers (with the same
 * specificity as `body`).
 */
const BODY_CHILD_PATTERN = /(^|[\s,(>~+])body\s*>/gi;
const BODY_CHILD_REPLACEMENT = "$1:is(body, :where(.pm-source, .pm-body)) >";
/**
 * Conditional group rules whose contents are processed as if they applied.
 * Rules nested inside any other (unknown) at-rule are left untouched so
 * that `@page` rules inside them are ignored, as browsers do.
 */
const TRANSPARENT_AT_RULES = new Set([
	"supports",
	"layer",
	"container",
	"scope",
	"starting-style",
]);

//-----------------------------------------------------------------------------
// Transformer
//-----------------------------------------------------------------------------

class Transformer {
	pageRules: PageRule[] = [];
	dynamicContent: DynamicContentRule[] = [];
	features = new Set<FeatureName>();
	/** Whether any `::before`/`::after` rule sets counter properties. */
	pseudoCounters = false;
	#order = 0;
	#hoistPrint: boolean;

	constructor(options: TransformOptions) {
		this.#hoistPrint = options.hoistPrint ?? true;
	}

	transformRules(rules: Rule[]): Rule[] {
		const output: Rule[] = [];

		for (const rule of rules) {
			output.push(...this.#transformRule(rule));
		}

		return output;
	}

	#transformRule(rule: Rule): Rule[] {
		if (rule.type === "style") {
			return [this.#transformStyleRule(rule)];
		}

		const name = rule.name.toLowerCase();

		if (name === "page") {
			const pageRule = createPageRule(rule, this.#order++);

			if (pageRule) {
				this.pageRules.push(pageRule);
				this.#noteFeaturesInPageRule(pageRule);
			}

			return [];
		}

		if (name === "footnote") {
			// Top-level @footnote applies to all pages.
			const wrapper: AtRule = {
				type: "at",
				name: "page",
				prelude: [],
				declarations: [],
				rules: [rule],
			};
			const pageRule = createPageRule(wrapper, this.#order++);

			if (pageRule) {
				this.pageRules.push(pageRule);
			}

			this.features.add("footnotes");
			return [];
		}

		if (name === "media") {
			const query = serialize(rule.prelude).toLowerCase();

			// Screen-only rules never apply to paged output; their contents
			// (including any @page rules) are dropped before being examined.
			if (this.#hoistPrint && /^\s*(only\s+)?screen\s*$/.test(query)) {
				return [];
			}

			const nested = this.transformRules(rule.rules ?? []);

			if (
				this.#hoistPrint &&
				/\bprint\b/.test(query) &&
				!/\bnot\s+print\b/.test(query)
			) {
				return nested;
			}

			return [{ ...rule, rules: nested }];
		}

		if (rule.rules && TRANSPARENT_AT_RULES.has(name)) {
			return [{ ...rule, rules: this.transformRules(rule.rules) }];
		}

		return [rule];
	}

	#noteFeaturesInPageRule(rule: PageRule): void {
		for (const selector of rule.selectors) {
			if (selector.blank) {
				this.features.add("blankPages");
			}

			if (selector.nth.length) {
				this.features.add("nthPages");
			}

			if (selector.name !== undefined) {
				this.features.add("namedPages");
			}

			if (selector.first || selector.left || selector.right) {
				this.features.add("pageSelectors");
			}
		}

		for (const declaration of rule.declarations) {
			if (declaration.name === "size") {
				this.features.add("pageSize");
			} else if (declaration.name === "marks") {
				this.features.add("marks");
			} else if (declaration.name === "bleed") {
				this.features.add("bleed");
			}
		}

		if (rule.footnote.length) {
			this.features.add("footnotes");
		}

		if (rule.marginBoxes.size) {
			this.features.add("marginBoxes");
		}

		for (const declarations of rule.marginBoxes.values()) {
			for (const declaration of declarations) {
				if (declaration.name === "content") {
					const content = parseContent(declaration.value);

					if (content) {
						this.#noteContentFeatures(content);
					}
				}
			}
		}
	}

	#noteContentFeatures(content: ContentValue, inFlow = false): void {
		if (content.type !== "list") {
			return;
		}

		for (const item of content.items) {
			switch (item.type) {
				case "string-ref":
					this.features.add("namedStrings");
					break;
				case "element":
					this.features.add("runningElements");
					break;
				case "target-counter":
				case "target-counters":
				case "target-text":
					this.features.add("crossReferences");
					break;
				case "leader":
					this.features.add("leaders");
					break;
				case "counter":
				case "counters":
					if (item.name === "page" || item.name === "pages") {
						this.features.add(
							inFlow ? "pageCountersInFlow" : "pageCounters",
						);
					} else if (item.name === "footnote") {
						this.features.add("footnotes");
					}

					break;
				default:
					break;
			}
		}
	}

	#transformStyleRule(rule: Rule & { type: "style" }): Rule {
		let selector = rule.selector.replace(
			BODY_CHILD_PATTERN,
			BODY_CHILD_REPLACEMENT,
		);

		if (/::footnote-(call|marker)/i.test(selector)) {
			this.features.add("footnotes");
			selector = selector
				.replace(/::footnote-call/gi, " > .pm-footnote-call")
				.replace(/::footnote-marker/gi, " > .pm-footnote-marker");
		}

		const declarations: Declaration[] = [];
		const isPseudo = /::?(before|after)\s*$/i.test(selector);

		for (const declaration of rule.declarations) {
			if (
				isPseudo &&
				/^counter-(reset|increment|set)$/i.test(declaration.name)
			) {
				this.pseudoCounters = true;
			}

			declarations.push(
				...this.#transformDeclaration(declaration, selector),
			);
		}

		return {
			...rule,
			selector,
			declarations,
			rules: this.transformRules(rule.rules),
		};
	}

	#transformDeclaration(
		declaration: Declaration,
		selector: string,
	): Declaration[] {
		const { name } = declaration;
		const parts = withoutWhitespace(declaration.value);
		const first = parts[0];

		switch (name) {
			case "string-set":
				this.features.add("namedStrings");
				return [{ ...declaration, name: CUSTOM_PROPERTIES.stringSet }];

			case "float":
				if (isIdent(first, "footnote")) {
					this.features.add("footnotes");
					return [{ ...declaration, name: CUSTOM_PROPERTIES.float }];
				}

				// Other float values also override an inherited-by-cascade
				// `float: footnote` from a less specific rule.
				return [
					declaration,
					{ ...declaration, name: CUSTOM_PROPERTIES.float },
				];

			case "position":
				if (!isFunction(first, "running")) {
					// `position: static` (etc.) from a more specific rule
					// cancels `position: running()` from a less specific one.
					return [
						declaration,
						{
							...declaration,
							name: CUSTOM_PROPERTIES.running,
							value: parseComponentValues("none"),
						},
					];
				}

				if (isFunction(first, "running")) {
					this.features.add("runningElements");
					const inner = withoutWhitespace(first.value)[0];

					if (isIdent(inner)) {
						return [
							{
								...declaration,
								name: CUSTOM_PROPERTIES.running,
								value: [inner],
							},
						];
					}

					return [];
				}

				return [declaration];

			case "footnote-display":
				this.features.add("footnotes");
				return [
					{ ...declaration, name: CUSTOM_PROPERTIES.footnoteDisplay },
				];

			case "footnote-policy":
				this.features.add("footnotes");
				return [
					{ ...declaration, name: CUSTOM_PROPERTIES.footnotePolicy },
				];

			case "break-before":
			case "break-after":
			case "page-break-before":
			case "page-break-after":
				if (
					isIdent(first) &&
					LEFT_RIGHT_BREAKS.has(first.value.toLowerCase())
				) {
					this.features.add("leftRightBreaks");
				}

				// Firefox's parser drops break values it does not implement
				// (left, right, recto, verso), so every declaration is
				// mirrored into a custom property that the layout engine
				// reads before the native computed value.
				return [
					declaration,
					{
						...declaration,
						name: name.endsWith("before")
							? CUSTOM_PROPERTIES.breakBefore
							: CUSTOM_PROPERTIES.breakAfter,
					},
				];

			case "orphans":
			case "widows":
				this.features.add("orphansWidows");

				// Firefox does not implement orphans/widows; mirrored like
				// the break properties above.
				return [
					declaration,
					{
						...declaration,
						name:
							name === "orphans"
								? CUSTOM_PROPERTIES.orphans
								: CUSTOM_PROPERTIES.widows,
					},
				];

			case "page":
				if (!isIdent(first, "auto")) {
					this.features.add("namedPages");
				}

				return [declaration];

			case "bookmark-level":
			case "bookmark-label":
			case "bookmark-state":
				this.features.add("bookmarks");
				return [declaration];

			case "content":
				return this.#transformContent(declaration, selector);

			default:
				return [declaration];
		}
	}

	#transformContent(
		declaration: Declaration,
		selector: string,
	): Declaration[] {
		const content = parseContent(declaration.value);

		if (!content || !isDynamicContent(content)) {
			return [declaration];
		}

		this.#noteContentFeatures(content, true);

		const match = PSEUDO_ELEMENT_PATTERN.exec(selector);

		if (!match) {
			// Content on a real element (not a pseudo) is only meaningful for
			// footnote calls/markers, which are handled by the layout engine.
			return [declaration];
		}

		const id = this.dynamicContent.length;
		const isFootnote = match[2] !== undefined;
		const pseudo = (match[1] ?? match[2]).toLowerCase();
		this.dynamicContent.push({
			id,
			selector: isFootnote
				? selector.trim()
				: selector.slice(0, match.index).trim(),
			pseudo,
			content,
		});

		if (isFootnote) {
			// Footnote calls and markers are real elements whose text is set
			// directly, so the content declaration is dropped.
			return [];
		}

		const property = `${CUSTOM_PROPERTIES.contentPrefix}${id}`;
		const output: Declaration[] = [
			{
				...declaration,
				value: parseComponentValues(`var(${property})`),
			},
		];

		const hasLeader =
			content.type === "list" &&
			content.items.some(item => item.type === "leader");

		if (hasLeader) {
			const extra = parseLeaderDeclarations(
				`${CUSTOM_PROPERTIES.leaderWidthPrefix}${id}`,
				declaration.important,
			);
			output.push(...extra);
		}

		return output;
	}
}

function parseLeaderDeclarations(
	widthProperty: string,
	important: boolean,
): Declaration[] {
	const css: [string, string][] = [
		["display", "inline-flex"],
		["justify-content", "flex-end"],
		["overflow", "hidden"],
		["white-space", "pre"],
		["vertical-align", "bottom"],
		["width", `var(${widthProperty}, auto)`],
	];

	return css.map(([name, value]) => ({
		type: "declaration",
		name,
		value: parseComponentValues(value),
		important,
	}));
}

//-----------------------------------------------------------------------------
// Public API
//-----------------------------------------------------------------------------

/**
 * Transforms author stylesheets for use with the polyfill.
 * @param sheets The parsed stylesheets, in document order.
 * @param options Transform options.
 * @returns The transform result.
 */
export function transformStylesheets(
	sheets: Stylesheet[],
	options: TransformOptions = {},
): TransformResult {
	if (!Array.isArray(sheets)) {
		throw new TypeError("Expected an array argument.");
	}

	const transformer = new Transformer(options);
	const cssParts: string[] = [];

	for (const sheet of sheets) {
		const rules = transformer.transformRules(sheet.rules);
		cssParts.push(serializeStylesheet({ rules }));
	}

	return {
		css: cssParts.join("\n"),
		pageRules: transformer.pageRules,
		dynamicContent: transformer.dynamicContent,
		features: transformer.features,
		pseudoCounters: transformer.pseudoCounters,
	};
}

/**
 * Returns the CSS that registers the polyfill's custom properties so they
 * are not inherited.
 * @returns The CSS text.
 */
export function customPropertyRegistrations(): string {
	const names = [
		CUSTOM_PROPERTIES.stringSet,
		CUSTOM_PROPERTIES.float,
		CUSTOM_PROPERTIES.running,
		CUSTOM_PROPERTIES.footnoteDisplay,
		CUSTOM_PROPERTIES.footnotePolicy,
		CUSTOM_PROPERTIES.breakBefore,
		CUSTOM_PROPERTIES.breakAfter,
	];
	// orphans and widows are inherited properties, so their mirrors must
	// inherit too.
	const inherited = [CUSTOM_PROPERTIES.orphans, CUSTOM_PROPERTIES.widows];

	return [
		...names.map(
			name => `@property ${name} { syntax: "*"; inherits: false; }`,
		),
		...inherited.map(
			name => `@property ${name} { syntax: "*"; inherits: true; }`,
		),
	].join("\n");
}
