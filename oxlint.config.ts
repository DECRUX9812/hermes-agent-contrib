import { defineConfig } from "oxlint";

/**
 * Anti-slop Oxlint rules — vendored from dmmulroy/anti-slop (v0.1.0).
 * Rejects low-evidence, low-signal TS/JS patterns typical of AI-generated code:
 * type laundering, chained assertions, unknown-typed dictionaries, unchecked casts.
 * Rules flag only; they do not auto-fix. See tools/oxlint/anti-slop/index.ts.
 */
export default defineConfig({
	ignorePatterns: [
			// local agent-tooling assets (kept out of lint)
			".agent/**",
			".agents/**",
			".claude/**",
			".codex/**",
			".continue/**",
			".cursor/**",
			".gemini/**",
			".opencode/**",
			".pi/**",
			".roo/**",
			".windsurf/**",
			// the vendored plugin itself
			"tools/oxlint/anti-slop/**",
			// build output / deps
			"**/node_modules/**",
			"**/dist/**",
			"**/build/**",
		],
		jsPlugins: [
			{ name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
		],
		rules: {
			"anti-slop/no-chained-type-assertions": "error",
			"anti-slop/no-conditional-empty-object-spread": "error",
			"anti-slop/no-known-value-widening": "error",
			"anti-slop/no-module-mocking": "error",
			"anti-slop/no-object-parameters": "error",
			"anti-slop/no-reflect-apply": "error",
			"anti-slop/no-reflect-get": "error",
			"anti-slop/no-runtime-typeof": "error",
			"anti-slop/no-shape-in-symbol-names": "error",
			"anti-slop/no-unknown-parameters": "error",
			"anti-slop/no-unknown-returns": "error",
			"anti-slop/no-unknown-type-aliases": "error",
			"anti-slop/no-unsafe-dictionary-type": "error",
			"anti-slop/no-widen-then-assert": "error",
			"anti-slop/require-safety-comment-for-type-assertion": "error",
		},
});
