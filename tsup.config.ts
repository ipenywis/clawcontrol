import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.tsx"],
  format: ["esm"],
  clean: true,
  target: "es2022",
  platform: "node",
  banner: {
    js: "#!/usr/bin/env node",
  },
  // Keep OpenTUI and native modules external - OpenTUI requires Bun runtime
  external: [
    "@opentui/core",
    "@opentui/react",
    "react",
    "ssh2",
    "cpu-features",
  ],
});
