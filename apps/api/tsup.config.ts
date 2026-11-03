import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  bundle: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  noExternal: [/.*/],
  banner: {
    js: 'import { createRequire as __paylCreateRequire } from "node:module"; const require = __paylCreateRequire(import.meta.url);',
  },
});
