import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: ["dist", "tests/fixtures"],
	},
	js.configs.recommended,
	tseslint.configs.recommended,
	{
		files: ["src/**/*.ts"],
		rules: {
			"no-console": "error",
		},
	},
);
