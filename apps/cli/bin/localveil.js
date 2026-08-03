#!/usr/bin/env node
import { fileURLToPath } from "node:url";

import { register } from "tsx/esm/api";

process.env.TSX_TSCONFIG_PATH ??= fileURLToPath(new URL("../tsconfig.json", import.meta.url));

register();

await import("../src/cli.tsx");
