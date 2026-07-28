#!/usr/bin/env node
import { fileURLToPath } from "node:url";

import { register } from "tsx/esm/api";

// Node can strip types from a .ts file on its own but not JSX from a .tsx one, so the
// entry point goes through tsx rather than running straight off disk. tsx looks for a
// tsconfig next to the working directory, which is wherever the command was run, so
// the app's own one has to be named outright or every component compiles as classic
// `React.createElement` and falls over.
process.env.TSX_TSCONFIG_PATH ??= fileURLToPath(new URL("../tsconfig.json", import.meta.url));

register();

await import("../src/cli.tsx");
