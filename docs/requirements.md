# Paged Media Poylfill

## Details

- Package name: `@humanwhocodes/paged-media`
- Description: CSS paged media polyfill for browsers.

## Goal

To fully implement the CSS paged media specification by polyfilling any features that aren't yet implemented in Chrome (via Puppeteer). The result is a JavaScript file that can be loaded into an HTML page to properly display using the CSS paged media standard syntax.

## Reference

PagedJS library, which does the same thing but is very out of date. Use this as inspiration for how it should work but not as the canonical reference for validation.

## Process

1. Evaluate current CSS paged media support in the latest version of Puppeteer.
2. Create a list of all CSS paged media features not supported in the latest version of Puppeteer.
3. Write TypeScript code that can polyfill the missing CSS paged media features.
4. Write tests to validate that the polyfill correctly implements the missing features. Seek out compliance and validation tests online from known good sources (PagedJS, W3C, browser vendors) for verification and to help create our own test suite.
