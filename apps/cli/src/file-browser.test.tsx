import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cleanup, render } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FileBrowser } from "./file-browser";

vi.mock("@repo/redact-node", () => ({
  createNodeRedactor: vi.fn(),
  SUPPORTED_EXTENSIONS: [".txt", ".md"],
}));

const DOWN = "\u001B[B";

const makeDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), "localveil-browser-"));

  await mkdir(join(directory, "photos"));
  await writeFile(join(directory, "notes.txt"), "Ada Lovelace");
  await writeFile(join(directory, "capture.raw"), "Ada Lovelace");

  return directory;
};

const openBrowser = async (
  directory: string,
  onConfirm = vi.fn<(files: Array<string>) => void>(),
) => {
  const view = render(
    <FileBrowser
      initialDirectory={directory}
      onCancel={vi.fn<() => void>()}
      onConfirm={onConfirm}
    />,
  );

  await vi.waitFor(() => {
    expect(view.lastFrame()).toContain("notes.txt");
  });

  return { ...view, onConfirm };
};

const frameHas = async (lastFrame: () => string | undefined, text: string) => {
  await vi.waitFor(() => {
    expect(lastFrame()).toContain(text);
  });
};

afterEach(() => {
  cleanup();
});

describe("FileBrowser", () => {
  it("lists the folders and files it finds, folders first", async () => {
    const directory = await makeDirectory();

    const { lastFrame } = await openBrowser(directory);
    const frame = lastFrame() ?? "";

    expect(frame).toContain("photos/");
    expect(frame).toContain("notes.txt");
    expect(frame).toContain("capture.raw");
    expect(frame.indexOf("photos/")).toBeLessThan(frame.indexOf("notes.txt"));
  });

  it("says out loud which files it cannot read instead of hiding them", async () => {
    const directory = await makeDirectory();

    const { lastFrame } = await openBrowser(directory);

    expect(lastFrame()).toContain("[-] capture.raw  unsupported");
  });

  it("refuses to pick a file it cannot read", async () => {
    const directory = await makeDirectory();

    const { lastFrame, stdin } = await openBrowser(directory);

    stdin.write(DOWN);
    stdin.write(DOWN);

    await frameHas(lastFrame, "> [-] capture.raw");

    stdin.write(" ");

    await frameHas(lastFrame, "Nothing picked yet.");
    expect(lastFrame()).toContain("[-] capture.raw");
  });

  it("ticks and unticks a file when space is pressed on it", async () => {
    const directory = await makeDirectory();

    const { lastFrame, stdin } = await openBrowser(directory);

    stdin.write(DOWN);
    stdin.write(DOWN);
    stdin.write(DOWN);

    await frameHas(lastFrame, "> [ ] notes.txt");

    stdin.write(" ");

    await frameHas(lastFrame, "> [x] notes.txt");
    expect(lastFrame()).toContain("1 picked");

    stdin.write(" ");

    await frameHas(lastFrame, "> [ ] notes.txt");
    expect(lastFrame()).toContain("Nothing picked yet.");
  });

  it("hands back the paths that were ticked when enter is pressed", async () => {
    const directory = await makeDirectory();

    const { lastFrame, onConfirm, stdin } = await openBrowser(directory);

    stdin.write(DOWN);
    stdin.write(DOWN);
    stdin.write(DOWN);

    await frameHas(lastFrame, "> [ ] notes.txt");

    stdin.write(" ");

    await frameHas(lastFrame, "1 picked");

    stdin.write("\r");

    await vi.waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith([join(directory, "notes.txt")]);
    });
  });

  it("stays put when enter is pressed with nothing ticked", async () => {
    const directory = await makeDirectory();

    const { lastFrame, onConfirm, stdin } = await openBrowser(directory);

    stdin.write(DOWN);
    stdin.write(DOWN);
    stdin.write(DOWN);

    await frameHas(lastFrame, "> [ ] notes.txt");

    stdin.write("\r");

    await frameHas(lastFrame, "Nothing picked yet.");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("walks into a folder when enter is pressed on it", async () => {
    const directory = await makeDirectory();

    await writeFile(join(directory, "photos", "holiday.md"), "Ada Lovelace");

    const { lastFrame, stdin } = await openBrowser(directory);

    stdin.write(DOWN);

    await frameHas(lastFrame, "> [>] photos/");

    stdin.write("\r");

    await frameHas(lastFrame, "holiday.md");
  });
});
