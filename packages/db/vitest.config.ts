import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		// PGlite の起動とマイグレーション適用に時間がかかるため既定の 5s を延ばす
		testTimeout: 30_000,
		hookTimeout: 30_000,
	},
});
