import { render } from "ink";

import { App } from "./app";
import { resolveArguments } from "./entries";

const workingDirectory = process.cwd();

const resolved = await resolveArguments(process.argv.slice(2), workingDirectory).catch(
  (error: unknown) => {
    // A bad flag is a usage error: name it on stderr and stop before any UI mounts.
    // oxlint-disable-next-line eslint/no-console
    console.error(error instanceof Error ? error.message : String(error));
    // oxlint-disable-next-line unicorn/no-process-exit
    process.exit(1);
  },
);

const { directory, language, selection } = resolved;

// Ink's own Ctrl+C handling unmounts without telling the app, which would abandon a
// temporary archive mid-write. The app takes the key itself instead.
const instance = render(
  <App
    initialDirectory={directory}
    initialSelection={selection}
    language={language}
    outputDirectory={workingDirectory}
  />,
  { exitOnCtrlC: false },
);

await instance.waitUntilExit();
