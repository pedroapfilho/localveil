import { render } from "ink";

import { App } from "./app";
import { resolveArguments } from "./entries";

const workingDirectory = process.cwd();
const { directory, selection } = await resolveArguments(process.argv.slice(2), workingDirectory);

// Ink's own Ctrl+C handling unmounts without telling the app, which would abandon a
// temporary archive mid-write. The app takes the key itself instead.
const instance = render(
  <App
    initialDirectory={directory}
    initialSelection={selection}
    outputDirectory={workingDirectory}
  />,
  { exitOnCtrlC: false },
);

await instance.waitUntilExit();
