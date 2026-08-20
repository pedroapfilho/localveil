import { render } from "ink";

import { App } from "./app";
import { resolveArguments } from "./entries";

const workingDirectory = process.cwd();

const resolved = await resolveArguments(process.argv.slice(2), workingDirectory).catch(
  (error: unknown) => {
    // oxlint-disable-next-line eslint/no-console
    console.error(error instanceof Error ? error.message : String(error));
    // oxlint-disable-next-line unicorn/no-process-exit
    process.exit(1);
  },
);

const { directory, jobs, selection } = resolved;

const instance = render(
  <App
    initialDirectory={directory}
    initialSelection={selection}
    jobs={jobs}
    outputDirectory={workingDirectory}
  />,
  { exitOnCtrlC: false },
);

await instance.waitUntilExit();
