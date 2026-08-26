/**
 * @fileoverview Renders an HTML file to PDF with the polyfill applied.
 * Usage: node scripts/render-pdf.js <input.html> <output.pdf>
 * @author Nicholas C. Zakas
 */

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import puppeteer from "puppeteer";

const [input, output] = process.argv.slice(2);

if (!input || !output) {
	console.error(
		"Usage: node scripts/render-pdf.js <input.html> <output.pdf>",
	);
	process.exit(1);
}

const bundle = await readFile(
	new URL("../dist/paged-media.js", import.meta.url),
	"utf8",
);
const browser = await puppeteer.launch({ args: ["--no-sandbox"] });

try {
	const page = await browser.newPage();
	page.on("console", message => console.log(`[browser] ${message.text()}`));
	await page.evaluateOnNewDocument(() => {
		window.PagedMediaConfig = { auto: false };
	});
	await page.goto(pathToFileURL(resolve(input)).href, { waitUntil: "load" });
	await page.addScriptTag({ content: bundle });
	const result = await page.evaluate(async () => {
		const { pageCount, polyfilled, polyfilledFeatures } =
			await window.PagedMedia.polyfill();
		return { pageCount, polyfilled, polyfilledFeatures };
	});
	console.log(JSON.stringify(result));
	await page.pdf({
		path: output,
		preferCSSPageSize: true,
		printBackground: true,
	});
	console.log(`Wrote ${output}`);
} finally {
	await browser.close();
}
