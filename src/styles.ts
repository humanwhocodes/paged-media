/**
 * @fileoverview The polyfill's own stylesheet for page boxes, margin boxes,
 * footnotes, and split elements.
 * @author Nicholas C. Zakas
 */

/**
 * The base stylesheet injected by the polyfill.
 */
export const BASE_STYLES = `
.pm-source {
	display: none !important;
}

.pm-pages {
	display: block;
}

.pm-page {
	position: relative;
	box-sizing: border-box;
	overflow: hidden;
	margin: 0 auto;
	break-after: page;
	page-break-after: always;
	background: white;
}

.pm-page:last-child {
	break-after: auto;
	page-break-after: auto;
}

.pm-pagebox {
	position: absolute;
	box-sizing: border-box;
	overflow: hidden;
}

.pm-area {
	position: absolute;
	box-sizing: border-box;
	display: flex;
	flex-direction: column;
	overflow: visible;
}

.pm-body {
	flex: 1 1 auto;
	min-height: 0;
	position: relative;
	overflow: visible;
	width: 100%;
}

.pm-footnotes {
	flex: 0 0 auto;
	width: 100%;
	box-sizing: border-box;
}

.pm-footnotes:empty {
	display: none;
}

.pm-footnote {
	display: block;
}

.pm-footnote[data-pm-display="inline"] {
	display: inline;
}

.pm-footnote-call {
	vertical-align: super;
	font-size: 0.75em;
	line-height: 0;
}

[data-pm-call-shell] {
	all: revert !important;
	display: inline !important;
}

.pm-footnote-marker {
	display: inline;
}

.pm-footnote-marker::after {
	content: ". ";
}

.pm-margin-box {
	position: absolute;
	box-sizing: border-box;
	display: flex;
	align-items: center;
	overflow: hidden;
}

.pm-margin-box > .pm-margin-content {
	flex: 1 1 auto;
	min-width: 0;
}

.pm-margin-row,
.pm-margin-column {
	position: absolute;
	box-sizing: border-box;
	display: flex;
}

.pm-margin-row {
	align-items: flex-start;
}

.pm-margin-column {
	flex-direction: column;
	align-items: flex-start;
}

.pm-margin-row > .pm-margin-box,
.pm-margin-column > .pm-margin-box {
	position: relative;
	flex: 0 0 auto;
}

.pm-margin-box.pm-top-left-corner,
.pm-margin-box.pm-bottom-left-corner {
	text-align: right;
	justify-content: flex-end;
}

.pm-margin-box.pm-top-right-corner,
.pm-margin-box.pm-bottom-right-corner {
	text-align: left;
	justify-content: flex-start;
}

.pm-margin-box.pm-top-left,
.pm-margin-box.pm-bottom-left {
	text-align: left;
}

.pm-margin-box.pm-top-center,
.pm-margin-box.pm-bottom-center {
	text-align: center;
}

.pm-margin-box.pm-top-right,
.pm-margin-box.pm-bottom-right {
	text-align: right;
}

.pm-margin-box.pm-left-top,
.pm-margin-box.pm-left-middle,
.pm-margin-box.pm-left-bottom,
.pm-margin-box.pm-right-top,
.pm-margin-box.pm-right-middle,
.pm-margin-box.pm-right-bottom {
	text-align: center;
}

.pm-margin-box.pm-left-top,
.pm-margin-box.pm-right-top {
	align-items: flex-start;
}

.pm-margin-box.pm-left-bottom,
.pm-margin-box.pm-right-bottom {
	align-items: flex-end;
}

.pm-margin-box img {
	max-width: 100%;
	max-height: 100%;
}

.pm-marks {
	position: absolute;
	inset: 0;
	pointer-events: none;
	overflow: visible;
}

.pm-page [data-pm-split-after] {
	border-bottom-width: 0 !important;
	padding-bottom: 0 !important;
	margin-bottom: 0 !important;
	border-bottom-left-radius: 0 !important;
	border-bottom-right-radius: 0 !important;
}

.pm-page [data-pm-continued="slice"] {
	border-top-width: 0 !important;
	padding-top: 0 !important;
	margin-top: 0 !important;
	border-top-left-radius: 0 !important;
	border-top-right-radius: 0 !important;
}

.pm-page [data-pm-split-after]::after {
	content: none !important;
}

.pm-page [data-pm-continued]::before {
	content: none !important;
}

.pm-page li[data-pm-continued] {
	list-style: none;
}

.pm-page li[data-pm-continued]::marker {
	content: "";
}

.pm-page [data-pm-running] {
	position: static;
}

.pm-anchor {
	display: none;
}

@media screen {
	.pm-pages {
		background: #888;
		padding: 16px 0;
	}

	.pm-page {
		margin: 0 auto 16px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
	}
}

@media print {
	html, body {
		margin: 0 !important;
		padding: 0 !important;
		background: none !important;
	}

	.pm-pages {
		padding: 0;
	}

	.pm-page {
		margin: 0 !important;
		box-shadow: none !important;
	}
}
`;
