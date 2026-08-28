/**
 * @fileoverview Renders an HTML file to PDF with the polyfill applied.
 * Usage: node scripts/render-pdf.js <input.html> <output.pdf>
 * Set BROWSER=firefox to render with Firefox instead of Chrome.
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
const firefox = process.env.BROWSER === "firefox";
const browser = await puppeteer.launch(
	firefox ? { browser: "firefox" } : { args: ["--no-sandbox"] },
);

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

	const options = {
		path: output,
		preferCSSPageSize: true,
		printBackground: true,
	};

	if (firefox) {
		// Firefox's WebDriver BiDi print ignores CSS `@page` sizes, so the
		// polyfill's sheet size is passed explicitly (documents mixing
		// sheet sizes get the first size for every page).
		const size = await page.evaluate(() => {
			const style = document.querySelector(
				'style[data-pm-styles="print"]',
			);
			const match = style?.textContent?.match(
				/size:\s*([\d.]+)px\s+([\d.]+)px/,
			);
			return match
				? { width: Number(match[1]), height: Number(match[2]) }
				: null;
		});

		if (size) {
			options.width = `${size.width / 96}in`;
			options.height = `${size.height / 96}in`;
			options.margin = { top: 0, right: 0, bottom: 0, left: 0 };
		}
	}

	await page.pdf(options);
	console.log(`Wrote ${output}`);
} finally {
	await browser.close();
}
