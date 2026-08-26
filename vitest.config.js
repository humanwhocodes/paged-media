import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/**/*.spec.ts", "tests/**/*.test.ts"],
		testTimeout: 60000,
		hookTimeout: 120000,
	},
});
