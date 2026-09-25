import { render } from "ink";

import { App } from "./app";
import { resolveArguments } from "./entries";
import { runModelsCommand } from "./models-command";

const workingDirectory = process.cwd();

const resolveOrExit = async (args: ReadonlyArray<string>) => {
  try {
    return await resolveArguments(args, workingDirectory);
  } catch (error) {
    // oxlint-disable-next-line eslint/no-console -- the CLI reports a bad argument on stderr
    console.error(error instanceof Error ? error.message : String(error));
    // oxlint-disable-next-line unicorn/no-process-exit -- the CLI stops on a bad argument before ink renders
    return process.exit(1);
  }
};

const redact = async (args: ReadonlyArray<string>) => {
  const { directory, jobs, model, selection } = await resolveOrExit(args);

  const instance = render(
    <App
      initialDirectory={directory}
      initialSelection={selection}
      jobs={jobs}
      model={model}
      outputDirectory={workingDirectory}
    />,
    { exitOnCtrlC: false },
  );

  await instance.waitUntilExit();
};

const args = process.argv.slice(2);

// A folder that happens to be called models is still reachable as ./models.
if (args[0] === "models") {
  process.exitCode = await runModelsCommand(args.slice(1), {
    err: process.stderr,
    out: process.stdout,
  });
} else {
  await redact(args);
}
