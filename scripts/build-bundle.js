/**
 * @fileoverview Builds the browser bundle with esbuild.
 * @author Nicholas C. Zakas
 */

import { build } from "esbuild";

await build({
	entryPoints: ["src/browser.ts"],
	bundle: true,
	format: "iife",
	target: ["chrome120"],
	outfile: "dist/paged-media.js",
	sourcemap: true,
	legalComments: "none",
});

await build({
	entryPoints: ["src/browser.ts"],
	bundle: true,
	format: "iife",
	target: ["chrome120"],
	outfile: "dist/paged-media.min.js",
	minify: true,
	sourcemap: true,
	legalComments: "none",
});
