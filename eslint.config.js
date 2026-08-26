import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
	{
		ignores: ["dist", "tests/fixtures", "tmp"],
	},
	js.configs.recommended,
	tseslint.configs.recommended,
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			globals: globals.browser,
		},
		rules: {
			"no-console": "error",
		},
	},
	{
		files: ["scripts/**/*.js", "tests/**/*.ts"],
		languageOptions: {
			globals: { ...globals.node, ...globals.browser },
		},
	},
);
