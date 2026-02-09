import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.tsx"],
  format: ["esm"],
  clean: true,
  target: "es2022",
  platform: "node",
  banner: {
    js: "#!/usr/bin/env bun",
  },
  // @opentui/core uses bun:ffi and Bun-specific import attributes, so it
  // must stay external and be resolved at runtime by the Bun runtime.
  external: [
    "@opentui/core",
    "@opentui/react",
    "react",
    "ssh2",
    "cpu-features",
  ],
});
