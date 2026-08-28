# CSS Paged Media Support in Chromium

This document records the results of probing the Chromium build shipped with
the latest Puppeteer for native CSS paged media support, and which features
the polyfill therefore provides. Re-run the probe with:

```shell
npm run probe:support
```

Last probed: Puppeteer 25.9.0 / Chrome 152.0.7977.54 (2026-08-26).

## Natively Supported (passed through unless `force: true`)

| Feature                                                    | Parse | Render | Notes                                                           |
| ---------------------------------------------------------- | ----- | ------ | --------------------------------------------------------------- |
| `@page { size }` (named sizes, lengths, orientation)       | ✅    | ✅     | Requires `preferCSSPageSize: true` in Puppeteer's `page.pdf()`. |
| `@page { margin }`                                         | ✅    | ✅     |                                                                 |
| `@page { page-orientation }`                               | ✅    | ✅     |                                                                 |
| `@page :first`, `:left`, `:right`                          | ✅    | ✅     |                                                                 |
| Named pages (`page: name`, `@page name`)                   | ✅    | ✅     | Different sizes per page work.                                  |
| All 16 page-margin boxes (`@top-center`, ...)              | ✅    | ✅     |                                                                 |
| `counter(page)` / `counter(pages)` in margin boxes         | ✅    | ✅     |                                                                 |
| `counter-reset` / `counter-increment` in `@page`           | ✅    | ✅     |                                                                 |
| `break-before/after: page`, `avoid`, `break-inside: avoid` | ✅    | ✅     |                                                                 |
| `orphans` / `widows`                                       | ✅    | ✅     |                                                                 |
| `box-decoration-break`                                     | ✅    | ✅     |                                                                 |

## Not Supported (polyfilled)

| Feature                                                                                     | Parse | Render | Polyfill status                                                |
| ------------------------------------------------------------------------------------------- | ----- | ------ | -------------------------------------------------------------- |
| `@page :blank`                                                                              | ❌    | ❌     | ✅ Implemented                                                 |
| `@page :nth(An+B)` (document pages and page groups)                                         | ❌    | ❌     | ✅ Implemented                                                 |
| `break-before/after: left`, `right`, `recto`, `verso` (blank page insertion)                | ✅    | ❌     | ✅ Implemented                                                 |
| `marks: crop cross`                                                                         | ❌    | ❌     | ✅ Implemented                                                 |
| `bleed`                                                                                     | ❌    | ❌     | ✅ Implemented                                                 |
| `string-set` / `string(name, first / start / last / first-except)`                          | ❌    | ❌     | ✅ Implemented                                                 |
| `content(text / before / after / first-letter)`                                             | ❌    | ❌     | ✅ Implemented                                                 |
| `position: running(name)` / `element(name, ...)`                                            | ❌    | ❌     | ✅ Implemented                                                 |
| `float: footnote`, `@footnote`, `::footnote-call`, `::footnote-marker`, `counter(footnote)` | ❌    | ❌     | ✅ Implemented                                                 |
| `footnote-display: block / inline`                                                          | ❌    | ❌     | ✅ Implemented                                                 |
| `footnote-policy: auto / line / block`                                                      | ❌    | ❌     | ✅ Implemented                                                 |
| `target-counter()`, `target-counters()`, `target-text()`                                    | ✅    | ❌     | ✅ Implemented                                                 |
| `leader()`                                                                                  | ❌    | ❌     | ✅ Implemented                                                 |
| `counter(page)` / `counter(pages)` in flow content (`::before`/`::after`)                   | ✅    | ❌     | ✅ Implemented                                                 |
| `@page` margin box variable dimension rules (spec §5.3.2.2)                                 | —     | —      | ✅ Implemented (used when polyfilling)                         |
| `bookmark-level`, `bookmark-label`, `bookmark-state`                                        | ❌    | ❌     | ❌ Not possible from the DOM; use Puppeteer's `outline` option |
| `footnote-display: compact`                                                                 | ❌    | ❌     | Treated as `block`                                             |

## Firefox

The polyfill also runs in Firefox (tested with the Firefox build shipped with
Puppeteer, via WebDriver BiDi). The runtime detection in `detectSupport()`
adapts automatically; the differences from Chromium (last checked: Firefox
154, 2026-08-28):

- Natively supported and passed through: `@page { size }` and margins,
  `:first`/`:left`/`:right`, named pages, and forced breaks
  (`page`, `left`, `right`).
- Additionally polyfilled in Firefox: the 16 page-margin boxes,
  `counter(page)`/`counter(pages)` in margin boxes, and `orphans`/`widows`
  (Firefox does not implement the properties, so the stylesheet transform
  mirrors them into `--pm-orphans`/`--pm-widows`).
- Firefox's parser drops `break-before`/`break-after: recto | verso`
  (and `orphans`/`widows`) instead of keeping them in the CSSOM, so those
  declarations are mirrored into custom properties by the transform, and
  read back from the raw `style` attribute text for inline styles.
- `@page :blank` parses in Firefox without being rendered, so the polyfill
  assumes `:blank` is unsupported everywhere rather than trusting a parse
  probe.
- The `page-orientation` descriptor is not implemented; Firefox ignores it
  in the polyfill's generated print stylesheet.
- Puppeteer's `page.pdf()` in Firefox ignores CSS `@page` sizes: pass
  explicit `width`/`height` and zero `margin` (see the README), and
  documents that mix sheet sizes print at the first size on every page.

## How the Probe Works

`scripts/probe-support.js` launches Chrome via Puppeteer and:

1. Inserts stylesheets and inspects the CSSOM to see whether descriptors,
   selectors, margin boxes, properties, and at-rules are retained (parse
   support).
2. Prints small documents to PDF and reads the PDF text and page sizes back
   with `pdfjs-dist` to see whether the features actually render (render
   support).

Some features (blank pages for `left`/`right` breaks, `target-counter()`,
page counters in flow content) parse but do not render, which is why the
polyfill treats them as unsupported regardless of the runtime detection in
`detectSupport()`.
