import { describeError } from "@repo/redact-core";
import { render } from "ink";

import { App } from "./app";
import { resolveArguments } from "./entries";
import { runModelsCommand } from "./models-command";
import { USAGE } from "./usage";

const workingDirectory = process.cwd();

const resolveOrExit = async (args: ReadonlyArray<string>) => {
  try {
    return await resolveArguments(args, workingDirectory);
  } catch (error) {
    process.stderr.write(`${describeError(error)}\n\n${USAGE}`);

    // oxlint-disable-next-line unicorn/no-process-exit -- the CLI stops on a bad argument before ink renders
    return process.exit(1);
  }
};

const redact = async (args: ReadonlyArray<string>) => {
  const { directory, help, selection, settings } = await resolveOrExit(args);

  if (help) {
    process.stdout.write(USAGE);

    return;
  }

  const instance = render(
    <App
      initialDirectory={directory}
      initialSelection={selection}
      outputDirectory={workingDirectory}
      settings={settings}
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
