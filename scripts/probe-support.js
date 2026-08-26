/**
 * @fileoverview Probes the current Puppeteer Chrome for CSS paged media
 * support. Outputs a JSON report to stdout.
 * @author Nicholas C. Zakas
 */

import puppeteer from "puppeteer";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

async function pdfInfo(buffer) {
	const doc = await getDocument({ data: new Uint8Array(buffer) }).promise;
	const pages = [];

	for (let i = 1; i <= doc.numPages; i++) {
		const page = await doc.getPage(i);
		const text = await page.getTextContent();
		const vp = page.getViewport({ scale: 1 });
		pages.push({
			width: vp.width,
			height: vp.height,
			text: text.items
				.map(item => item.str)
				.join(" ")
				.trim(),
		});
	}

	return pages;
}

async function main() {
	const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
	const page = await browser.newPage();
	const report = { version: await browser.version(), parse: {}, render: {} };

	await page.setContent("<!doctype html><html><body></body></html>");

	// ---- Parse probes (CSSOM) ----
	report.parse = await page.evaluate(() => {
		const out = {};

		function sheetFor(css) {
			const style = document.createElement("style");
			style.textContent = css;
			document.head.append(style);
			const sheet = style.sheet;
			style.remove();
			return sheet;
		}

		function pageDescriptor(name, value) {
			const sheet = sheetFor(`@page { ${name}: ${value}; }`);
			const rule = sheet.cssRules[0];
			return !!rule && rule.style.getPropertyValue(name) !== "";
		}

		function pageSelector(sel) {
			const sheet = sheetFor(`@page ${sel} { margin: 1in; }`);
			return sheet.cssRules.length === 1;
		}

		function marginBox(name) {
			const sheet = sheetFor(`@page { ${name} { content: "x"; } }`);
			const rule = sheet.cssRules[0];
			const text = rule ? rule.cssText : "";
			return text.includes(name);
		}

		out.descriptors = {};

		for (const [name, value] of [
			["size", "A4 landscape"],
			["margin", "1in"],
			["marks", "crop cross"],
			["bleed", "6pt"],
			["page-orientation", "rotate-left"],
			["counter-reset", "page 1"],
			["counter-increment", "page 2"],
		]) {
			out.descriptors[name] = pageDescriptor(name, value);
		}

		out.selectors = {};

		for (const sel of [
			":first",
			":left",
			":right",
			":blank",
			":nth(2)",
			":nth(2n+1)",
			"chapter",
			"chapter:first",
			":recto",
			":verso",
		]) {
			out.selectors[sel] = pageSelector(sel);
		}

		out.marginBoxes = {};

		for (const name of [
			"@top-left-corner",
			"@top-left",
			"@top-center",
			"@top-right",
			"@top-right-corner",
			"@left-top",
			"@left-middle",
			"@left-bottom",
			"@right-top",
			"@right-middle",
			"@right-bottom",
			"@bottom-left-corner",
			"@bottom-left",
			"@bottom-center",
			"@bottom-right",
			"@bottom-right-corner",
		]) {
			out.marginBoxes[name] = marginBox(name);
		}

		out.properties = {};

		for (const [prop, value] of [
			["page", "chapter"],
			["break-before", "page"],
			["break-before", "left"],
			["break-before", "right"],
			["break-before", "recto"],
			["break-before", "verso"],
			["break-before", "avoid-page"],
			["break-after", "page"],
			["break-inside", "avoid"],
			["break-inside", "avoid-page"],
			["page-break-before", "always"],
			["orphans", "3"],
			["widows", "3"],
			["box-decoration-break", "clone"],
			["string-set", "title content(text)"],
			["string-set", "none"],
			["float", "footnote"],
			["footnote-display", "block"],
			["footnote-policy", "auto"],
			["content", "string(title)"],
			["content", "string(title, first)"],
			["content", "element(header)"],
			["content", "counter(page)"],
			["content", "counter(pages)"],
			["content", "counter(footnote)"],
			["content", "target-counter(attr(href), page)"],
			["content", "target-counter(attr(href url), page)"],
			["content", "target-text(attr(href))"],
			["content", "leader(dotted)"],
			["content", "leader('.')"],
			["position", "running(header)"],
			["counter-increment", "page"],
			["counter-reset", "page"],
			["bookmark-level", "1"],
			["bookmark-label", "content(text)"],
			["page-orientation", "upright"],
		]) {
			out.properties[`${prop}: ${value}`] = CSS.supports(prop, value);
		}

		out.atRules = {};

		for (const rule of [
			"@footnote { border-top: 1px solid; }",
			"@page { @footnote { border-top: 1px solid; } }",
		]) {
			const sheet = sheetFor(rule);
			out.atRules[rule] = sheet.cssRules.length === 1;
		}

		out.pseudoElements = {};

		for (const sel of [
			"::footnote-call",
			"::footnote-marker",
			"::marker",
			"::first-letter",
		]) {
			const sheet = sheetFor(`p${sel} { color: red; }`);
			out.pseudoElements[sel] = sheet.cssRules.length === 1;
		}

		return out;
	});

	// ---- Render probes (PDF) ----
	async function render(html) {
		await page.setContent(html, { waitUntil: "load" });
		const buffer = await page.pdf({ preferCSSPageSize: true });
		return pdfInfo(buffer);
	}

	const renders = {
		marginBoxes: `<style>@page { size: 4in 4in; margin: 1in; @top-center { content: "HEADERTEXT"; } @bottom-right { content: "FOOTERTEXT"; } }</style><p>Body</p>`,
		pageCounters: `<style>@page { size: 4in 4in; margin: 1in; @bottom-center { content: "Page " counter(page) " of " counter(pages); } }</style><p>One</p><p style="break-before:page">Two</p>`,
		namedPages: `<style>@page { size: 4in 4in; margin: 0.5in; } @page wide { size: 6in 4in; } .w { page: wide; }</style><p>One</p><div class="w">Two</div>`,
		firstPage: `<style>@page { size: 4in 4in; margin: 1in; @top-center { content: "REGULAR"; } } @page :first { @top-center { content: "FIRSTPAGE"; } }</style><p>One</p><p style="break-before:page">Two</p>`,
		leftRight: `<style>@page { size: 4in 4in; margin: 1in; } @page :left { @top-left { content: "LEFTPAGE"; } } @page :right { @top-right { content: "RIGHTPAGE"; } }</style><p>One</p><p style="break-before:page">Two</p>`,
		breakRight: `<style>@page { size: 4in 4in; margin: 1in; @top-center { content: "P" counter(page); } }</style><p>One</p><p style="break-before:right">Three</p>`,
		blankPage: `<style>@page { size: 4in 4in; margin: 1in; @top-center { content: "P" counter(page); } } @page :blank { @top-center { content: "BLANKPAGE"; } }</style><p>One</p><p style="break-before:right">Three</p>`,
		nthPage: `<style>@page { size: 4in 4in; margin: 1in; @top-center { content: "REGULAR"; } } @page :nth(2) { @top-center { content: "SECONDPAGE"; } }</style><p>One</p><p style="break-before:page">Two</p>`,
		stringSet: `<style>@page { size: 4in 4in; margin: 1in; @top-center { content: string(title); } } h1 { string-set: title content(text); }</style><h1>Chapter Title</h1><p>Body</p>`,
		runningElements: `<style>@page { size: 4in 4in; margin: 1in; @top-center { content: element(header); } } .hdr { position: running(header); }</style><div class="hdr">RUNNINGHEADER</div><p>Body</p>`,
		footnotes: `<style>@page { size: 4in 4in; margin: 1in; } .fn { float: footnote; }</style><p>Body<span class="fn">FOOTNOTETEXT</span></p>`,
		targetCounter: `<style>@page { size: 4in 4in; margin: 1in; } a::after { content: " [page " target-counter(attr(href), page) "]"; }</style><p><a href="#x">Link</a></p><p id="x" style="break-before:page">Target</p>`,
		pageCounterReset: `<style>@page { size: 4in 4in; margin: 1in; @top-center { content: "P" counter(page); } } .r { counter-reset: page 9; }</style><p>One</p><p class="r" style="break-before:page">Two</p>`,
		marksBleed: `<style>@page { size: 4in 4in; margin: 1in; marks: crop cross; bleed: 0.25in; }</style><p>Body</p>`,
		pageOrientation: `<style>@page { size: 4in 6in; margin: 0.5in; page-orientation: rotate-left; }</style><p>Body</p>`,
		breakInsideAvoid: `<style>@page { size: 4in 4in; margin: 1in; } p { margin: 0; line-height: 0.5in; } .box { break-inside: avoid; }</style><p>A</p><p>B</p><p>C</p><div class="box"><p>D</p><p>E</p></div>`,
		leader: `<style>@page { size: 4in 4in; margin: 1in; } .l::after { content: leader(dotted) "42"; }</style><p class="l">Item</p>`,
	};

	for (const [name, html] of Object.entries(renders)) {
		report.render[name] = await render(html);
	}

	await browser.close();
	console.log(JSON.stringify(report, null, "\t"));
}

main().catch(error => {
	console.error(error);
	process.exit(1);
});
