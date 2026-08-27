# Paged Media Polyfill

by [Nicholas C. Zakas](https://humanwhocodes.com)

If you find this useful, please consider supporting my work with a [donation](https://humanwhocodes.com/donate).

## Description

A CSS paged media polyfill for browsers. Load one script into an HTML page and the page is laid out according to the [CSS Paged Media](https://www.w3.org/TR/css-page-3/) and [CSS Generated Content for Paged Media](https://www.w3.org/TR/css-gcpm-3/) specifications, including the features Chromium doesn't implement yet:

- `@page :blank` and `@page :nth(An+B)` page selectors (including page groups for named pages)
- Blank page insertion for `break-before`/`break-after: left | right | recto | verso`
- Printer's marks (`marks: crop cross`) and `bleed`
- Named strings: `string-set` and `string(name, first | start | last | first-except)`
- Running elements: `position: running(name)` and `element(name, ...)`
- Footnotes: `float: footnote`, `@footnote`, `::footnote-call`, `::footnote-marker`, `footnote-display`, `footnote-policy`
- Cross references: `target-counter()`, `target-counters()`, `target-text()`
- Leaders: `leader(dotted | solid | space | "string")`
- `counter(page)` and `counter(pages)` in flow content (`::before`/`::after`)
- CSS counters (including `counters()` and counters incremented in `::before`/`::after`), `counter-reset: page` on elements, and `var()` in `@page` descriptors continue to work across generated pages
- The spec's variable dimension rules for page-margin boxes

Features Chromium already supports natively (page sizes, margins, margin boxes, page counters, `:first`/`:left`/`:right`, named pages, forced breaks, orphans/widows) pass through untouched: the polyfill detects which features a document uses, and if the browser supports all of them it does nothing. See [docs/support.md](docs/support.md) for the full support matrix and [docs/comparison.md](docs/comparison.md) for a feature comparison with Paged.js.

The polyfill was designed for producing PDFs with [Puppeteer](https://pptr.dev/) but works in any Chromium-based browser, on screen as well as in print.

## Installation

```shell
npm install @humanwhocodes/paged-media
```

## Usage

### In an HTML page

Include the browser bundle. It runs automatically when the page loads and exposes `window.PagedMedia`:

```html
<link rel="stylesheet" href="book.css" />
<script src="node_modules/@humanwhocodes/paged-media/dist/paged-media.min.js"></script>
```

To configure or disable the automatic run, define `window.PagedMediaConfig` before the script:

```html
<script>
	window.PagedMediaConfig = {
		auto: false, // run manually with PagedMedia.polyfill()
		defaultPageSize: "A4", // used when @page has no `size`
		defaultMargin: "2cm", // used when @page has no `margin`
	};
</script>
```

`window.PagedMedia.ready` is a promise that resolves with the result of the automatic run, and the document dispatches a `pagedmedia:rendered` event when layout is complete.

### With Puppeteer

```js
import puppeteer from "puppeteer";
import { readFile } from "node:fs/promises";

const bundle = await readFile(
	"node_modules/@humanwhocodes/paged-media/dist/paged-media.min.js",
	"utf8",
);

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto("http://localhost:8080/book.html", { waitUntil: "load" });
await page.addScriptTag({ content: bundle });

const result = await page.evaluate(() => window.PagedMedia.polyfill());
console.log(`${result.pageCount} pages`);

await page.pdf({
	path: "book.pdf",
	preferCSSPageSize: true, // required so @page sizes are honored
	printBackground: true,
});

await browser.close();
```

Serve documents over HTTP where possible: external stylesheets are fetched so that unsupported rules can be read, and browsers refuse `fetch()` for `file:` URLs. When a stylesheet cannot be fetched the polyfill falls back to the browser's parsed copy (which drops unsupported rules) and reports it in `result.warnings`. Inline `<style>` elements always work.

A ready-made script is included in the repository: `node scripts/render-pdf.js input.html output.pdf`.

### As a module

```js
import { polyfill, detectSupport } from "@humanwhocodes/paged-media";

const support = detectSupport(); // { marginBoxes: true, namedStrings: false, ... }
const result = await polyfill({ force: false });
```

`polyfill(options)` returns a promise for a result object:

| Property             | Description                                                           |
| -------------------- | --------------------------------------------------------------------- |
| `polyfilled`         | Whether the document was paginated by the polyfill.                   |
| `pageCount`          | The number of pages generated.                                        |
| `features`           | The paged media features the document uses.                           |
| `polyfilledFeatures` | The features that required the polyfill.                              |
| `support`            | The native support report from `detectSupport()`.                     |
| `pages`              | The generated page boxes (`PageBox` objects with their DOM elements). |
| `warnings`           | Non-fatal problems, such as stylesheets that could not be loaded.     |

Options:

| Option            | Default  | Description                                                                        |
| ----------------- | -------- | ---------------------------------------------------------------------------------- |
| `force`           | `false`  | Paginate even if every feature the document uses is natively supported.            |
| `defaultPageSize` | `letter` | Page size when `@page` has no `size` (e.g. `"A4"`, `"A4 landscape"`, `"6in 9in"`). |
| `defaultMargin`   | `0.4in`  | Page margin when `@page` has no `margin`.                                          |
| `hoistPrint`      | `true`   | Apply rules inside `@media print` unconditionally and drop `@media screen`.        |
| `maxPages`        | `5000`   | Safety limit on the number of generated pages.                                     |
| `document`        | global   | The document to paginate.                                                          |
| `onPage`          |          | Called with each `PageBox` after it is laid out.                                   |

The CSS parser and the `@page` cascade are also exported (`parseStylesheet`, `transformStylesheets`, `resolvePageStyle`, `computeMarginBoxSizes`, ...) for tools that want to analyze paged media stylesheets in Node.js.

## How It Works

1. The document's stylesheets are parsed with the polyfill's own CSS parser (the browser's CSSOM discards everything it doesn't understand). `@page` rules are extracted, unsupported properties are rewritten into registered custom properties (`string-set` becomes `--pm-string-set`, `float: footnote` becomes `--pm-float: footnote`, and so on), and dynamic `content` values are replaced with `var()` references.
2. If the document only uses natively supported features, the polyfill stops here and the browser prints the page normally.
3. Otherwise the body content is moved into a hidden container and cloned, node by node, into fixed-size page boxes. When a page overflows, the best break point is chosen honoring forced breaks, `break-inside`/`break-before`/`break-after: avoid`, `orphans`, and `widows`; text is split at line boundaries; tables repeat their `<thead>`; ordered lists keep their numbering; split boxes slice or clone their decorations per `box-decoration-break`.
4. Footnotes are moved into the page's footnote area as they are encountered (the footnote area shrinks the page area), running elements are captured, and named strings are recorded per page.
5. Page counters, margin boxes (sized per the spec's variable dimension rules), cross references, and leaders are resolved once pagination is complete.
6. A print stylesheet sets each `@page` to the sheet size (page plus bleed and marks) with zero margins, so printing produces exactly the generated pages.

### Notes and limitations

- Content is moved into page boxes, so `body` is no longer its direct parent. Child combinators on `body` (`body > h1`) are rewritten to match the page containers as well; other selectors that depend on the original ancestry (`html > body > h1` with a class on `body`, for instance) may stop matching.
- Content inside `display: flex`/`grid` containers, positioned elements, and inline-blocks is treated as unbreakable unless it is taller than a page.
- `footnote-display: compact` is treated as `block`.
- PDF bookmarks (`bookmark-level` and friends) cannot be produced from the DOM; use Puppeteer's `outline: true` option instead.
- `@page :first` with a page name (`@page chapter:first`) matches the first page of each group of consecutive `chapter` pages; a bare `:first` matches only the first page of the document. `:nth()` counts within the page group when a name is given, otherwise within the document.

## Development

```shell
npm test          # unit tests (Node) and integration tests (Puppeteer)
npm run build     # library (dist/index.js) and browser bundle (dist/paged-media.js)
npm run lint      # ESLint and TypeScript
npm run probe:support   # regenerate the native support probe (docs/support.md)
npm run render:pdf -- input.html output.pdf
```

Integration tests render fixtures in `tests/fixtures` with Puppeteer, inspect the generated DOM, and read the printed PDFs back with pdf.js to verify page sizes and text.

Visual regression tests (`tests/screenshots.test.ts`) screenshot every page of each fixture and compare them pixel-by-pixel against the baselines committed in `tests/screenshots/baseline/<platform>/`. The current screenshots are always written to `tests/screenshots/current/` so you can look at what was rendered, and any mismatch writes a highlighted diff image to `tests/screenshots/diff/` and fails the test. After an intentional rendering change, refresh the baselines with:

```shell
npm run test:screenshots:update
```

Fixtures use bundled DejaVu fonts (`tests/fixtures/fonts.css`) rather than system fonts, so rendering is the same on every machine; baselines are still recorded per platform because rasterization differs between operating systems, and on CI the screenshot tests are skipped on platforms without baselines.

## Acknowledgements

This project is inspired by [PagedJS](https://pagedjs.org), the original CSS Paged Media polyfill. None of the code in this project is from PagedJS.

## License

Copyright 2026 Nicholas C. Zakas

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
