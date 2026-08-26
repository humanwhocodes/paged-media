/**
 * @fileoverview Puppeteer helpers for integration tests.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extname, join, normalize, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

export interface PageSummary {
	index: number;
	number: string | null;
	name: string | null;
	classes: string[];
	blank: boolean;
	width: number;
	height: number;
	/** Text of the flow content (whitespace collapsed). */
	body: string;
	/** Amount by which the flow content overflows its area. */
	overflow: number;
	footnotes: string;
	/** Margin box text keyed by box name (only generated boxes). */
	boxes: Record<string, string>;
}

export interface RenderResult {
	polyfilled: boolean;
	pageCount: number;
	polyfilledFeatures: string[];
	features: string[];
	pages: PageSummary[];
	errors: string[];
}

export interface PdfPage {
	width: number;
	height: number;
	text: string;
}

//-----------------------------------------------------------------------------
// Browser Management
//-----------------------------------------------------------------------------

const BUNDLE_PATH = new URL("../../dist/paged-media.js", import.meta.url);
const FIXTURES_DIR = new URL("../fixtures/", import.meta.url);
const ROOT_DIR = fileURLToPath(new URL("../../", import.meta.url));

const MIME_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
};

let browser: Browser | undefined;
let bundle: string | undefined;
let server: Server | undefined;
let baseURL = "";

/**
 * Starts (or returns) the static file server serving the project root.
 * @returns The base URL.
 */
export async function getServer(): Promise<string> {
	if (server) {
		return baseURL;
	}

	server = createServer(async (request, response) => {
		const url = new URL(request.url ?? "/", "http://localhost");
		const path = normalize(
			join(ROOT_DIR, decodeURIComponent(url.pathname)),
		);

		if (!path.startsWith(ROOT_DIR)) {
			response.writeHead(403).end();
			return;
		}

		try {
			const data = await readFile(path);
			response.writeHead(200, {
				"Content-Type":
					MIME_TYPES[extname(path)] ?? "application/octet-stream",
			});
			response.end(data);
		} catch {
			response.writeHead(404).end();
		}
	});

	await new Promise<void>(resolveListen =>
		server!.listen(0, "127.0.0.1", resolveListen),
	);
	const { port } = server.address() as AddressInfo;
	baseURL = `http://127.0.0.1:${port}/`;
	return baseURL;
}

/**
 * Launches (or returns) the shared browser.
 * @returns The browser.
 */
export async function getBrowser(): Promise<Browser> {
	if (!browser) {
		browser = await puppeteer.launch({
			args: ["--no-sandbox", "--font-render-hinting=none"],
		});
	}

	return browser;
}

/**
 * Closes the shared browser.
 */
export async function closeBrowser(): Promise<void> {
	if (browser) {
		await browser.close();
		browser = undefined;
	}

	if (server) {
		await new Promise<void>(resolveClose =>
			server!.close(() => resolveClose()),
		);
		server = undefined;
	}
}

async function getBundle(): Promise<string> {
	if (!bundle) {
		bundle = await readFile(BUNDLE_PATH, "utf8");
	}

	return bundle;
}

/**
 * Returns the HTTP URL of a fixture (the server must be started).
 * @param name The fixture file name.
 * @returns The URL.
 */
export function fixtureURL(name: string): string {
	return `${baseURL}tests/fixtures/${name}`;
}

/**
 * Opens a fixture in a new page with the bundle loaded (auto-run disabled).
 * @param nameOrHtml The fixture file name, or inline HTML when `inline` is true.
 * @param inline Whether the first argument is HTML.
 * @returns The page.
 */
export async function openFixture(
	nameOrHtml: string,
	inline = false,
): Promise<Page> {
	await getServer();
	const page = await (await getBrowser()).newPage();
	await page.setViewport({ width: 900, height: 900 });
	await page.evaluateOnNewDocument(() => {
		window.PagedMediaConfig = { auto: false };
	});

	if (inline) {
		await page.goto(fixtureURL("blank.html"), { waitUntil: "load" });
		await page.setContent(nameOrHtml, { waitUntil: "load" });
	} else {
		await page.goto(fixtureURL(nameOrHtml), { waitUntil: "load" });
	}

	await page.addScriptTag({ content: await getBundle() });
	return page;
}

/**
 * Runs the polyfill in a page and summarizes the result.
 * @param page The page.
 * @param options Polyfill options.
 * @returns The render result.
 */
export async function runPolyfill(
	page: Page,
	options: Record<string, unknown> = {},
): Promise<RenderResult> {
	const errors: string[] = [];
	page.on("pageerror", error => errors.push(error.message));

	const result = await page.evaluate(async polyfillOptions => {
		const outcome = await window.PagedMedia!.polyfill(polyfillOptions);
		const pages = [
			...document.querySelectorAll<HTMLElement>(".pm-page"),
		].map((element, index) => {
			const boxes: Record<string, string> = {};

			for (const box of element.querySelectorAll<HTMLElement>(
				".pm-margin-box",
			)) {
				if (box.hasAttribute("data-pm-empty")) {
					continue;
				}

				const name = box.className.replace("pm-margin-box pm-", "");
				boxes[name] = (box.textContent ?? "")
					.replace(/\s+/g, " ")
					.trim();
			}

			const body = element.querySelector<HTMLElement>(".pm-body")!;
			const footnotes =
				element.querySelector<HTMLElement>(".pm-footnotes")!;
			const rect = element.getBoundingClientRect();

			return {
				index: index + 1,
				number: element.getAttribute("data-pm-page-number"),
				name: element.getAttribute("data-pm-page-name"),
				classes: [...element.classList],
				blank: element.hasAttribute("data-pm-blank"),
				width: rect.width,
				height: rect.height,
				body: (body.textContent ?? "").replace(/\s+/g, " ").trim(),
				overflow: body.scrollHeight - body.clientHeight,
				footnotes: (footnotes.textContent ?? "")
					.replace(/\s+/g, " ")
					.trim(),
				boxes,
			};
		});

		return {
			polyfilled: outcome.polyfilled,
			pageCount: outcome.pageCount,
			polyfilledFeatures: outcome.polyfilledFeatures,
			features: outcome.features,
			pages,
		};
	}, options);

	return { ...result, errors };
}

/**
 * Prints a page to PDF and extracts per-page sizes and text.
 * @param page The page.
 * @returns The PDF pages.
 */
export async function printToPdf(page: Page): Promise<PdfPage[]> {
	const buffer = await page.pdf({
		preferCSSPageSize: true,
		printBackground: true,
	});
	const doc = await getDocument({ data: new Uint8Array(buffer) }).promise;
	const pages: PdfPage[] = [];

	for (let i = 1; i <= doc.numPages; i++) {
		const pdfPage = await doc.getPage(i);
		const viewport = pdfPage.getViewport({ scale: 1 });
		const content = await pdfPage.getTextContent();
		pages.push({
			width: viewport.width,
			height: viewport.height,
			text: content.items
				.map(item => ("str" in item ? item.str : ""))
				.join(" ")
				.replace(/\s+/g, " ")
				.trim(),
		});
	}

	return pages;
}

/**
 * Resolves a path relative to the fixtures directory.
 * @param name The file name.
 * @returns The absolute path.
 */
export function fixturePath(name: string): string {
	return resolve(new URL(name, FIXTURES_DIR).pathname);
}

/**
 * Converts a path to a file URL (re-exported convenience).
 * @param path The path.
 * @returns The file URL.
 */
export function toFileURL(path: string): string {
	return pathToFileURL(path).href;
}
