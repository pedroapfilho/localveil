import { render } from "ink";

import { App } from "./app";
import { resolveArguments } from "./entries";

const workingDirectory = process.cwd();

const resolveOrExit = async () => {
  try {
    return await resolveArguments(process.argv.slice(2), workingDirectory);
  } catch (error) {
    // oxlint-disable-next-line eslint/no-console
    console.error(error instanceof Error ? error.message : String(error));
    // oxlint-disable-next-line unicorn/no-process-exit
    return process.exit(1);
  }
};

const resolved = await resolveOrExit();

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
