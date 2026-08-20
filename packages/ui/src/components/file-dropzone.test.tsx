import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FileDropzone } from "./file-dropzone";

const textFile = (name = "notes.txt") => new File(["hello"], name, { type: "text/plain" });

const withFiles = (files: Array<File>) => ({
  dataTransfer: { files, items: [], types: ["Files"] },
});

const inputNamed = (name: RegExp | string) => {
  const input = screen.getByLabelText(name);

  if (!(input instanceof HTMLInputElement)) {
    throw new TypeError("The labelled control is not a file input");
  }

  return input;
};

const setup = (props: Partial<Parameters<typeof FileDropzone>[0]> = {}) => {
  const onFilesSelected = vi.fn<(files: Array<{ file: File; path: string }>) => void>();

  render(
    <FileDropzone
      filesLabel="Choose files"
      folderLabel="Choose a folder"
      hint="or drag and drop them here"
      label="Add files or folders"
      onFilesSelected={onFilesSelected}
      {...props}
    />,
  );

  const zone = screen.getByRole("button", { name: /add files or folders/iv });

  if (!(zone instanceof HTMLButtonElement)) {
    throw new TypeError("The dropzone is not a button");
  }

  return {
    directory: inputNamed(/choose a folder/iv),
    input: inputNamed(/choose files/iv),
    onFilesSelected,
    zone,
  };
};

const openMenu = async (zone: HTMLElement, item: RegExp) => {
  fireEvent.click(zone);

  fireEvent.click(await screen.findByRole("menuitem", { name: item }));
};

describe("FileDropzone", () => {
  it("opens the file picker from the menu when the zone is clicked", async () => {
    const { input, zone } = setup();
    const opened = vi.spyOn(input, "click");

    await openMenu(zone, /choose files/iv);

    expect(opened).toHaveBeenCalled();
  });

  it("keeps the zone reachable by keyboard and the inputs out of the tab order", () => {
    const { directory, input, zone } = setup();

    expect(zone.disabled).toBe(false);
    expect(input.tabIndex).toBe(-1);
    expect(directory.tabIndex).toBe(-1);
  });

  it("flags dragging while files are over the zone and clears it on leave", () => {
    const { zone } = setup();

    fireEvent.dragOver(zone, withFiles([textFile()]));
    expect(zone.dataset.dragging).toBe("true");

    fireEvent.dragLeave(zone);
    expect(zone.dataset.dragging).toBeUndefined();
  });

  it("reports dropped files and clears the dragging flag", async () => {
    const { onFilesSelected, zone } = setup();
    const dropped = textFile();

    fireEvent.dragOver(zone, withFiles([dropped]));
    fireEvent.drop(zone, withFiles([dropped]));

    await waitFor(() => {
      expect(onFilesSelected).toHaveBeenCalledWith([{ file: dropped, path: "notes.txt" }]);
    });
    expect(zone.dataset.dragging).toBeUndefined();
  });

  it("ignores a drop that carries no files", async () => {
    const { onFilesSelected, zone } = setup();

    fireEvent.drop(zone, withFiles([]));

    await waitFor(() => {
      expect(onFilesSelected).not.toHaveBeenCalled();
    });
  });

  it("reports a folder that the browser could not read", async () => {
    const onError = vi.fn<() => void>();
    const { zone } = setup({ onError });

    fireEvent.drop(zone, {
      dataTransfer: {
        files: [],
        items: [
          {
            kind: "file",
            webkitGetAsEntry: () => {
              throw new DOMException("Unreadable", "NotReadableError");
            },
          },
        ],
        types: ["Files"],
      },
    });

    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });
  });

  it("reports files chosen through the input", () => {
    const { input, onFilesSelected } = setup();
    const chosen = textFile();

    fireEvent.change(input, { target: { files: [chosen] } });

    expect(onFilesSelected).toHaveBeenCalledWith([{ file: chosen, path: "notes.txt" }]);
  });

  it("clears the input so the same file can be chosen twice in a row", () => {
    const { input } = setup();

    fireEvent.change(input, { target: { files: [textFile()] } });

    expect(input.value).toBe("");
  });

  it("ignores clicks and drops while disabled", () => {
    const { input, onFilesSelected, zone } = setup({ disabled: true });

    fireEvent.click(zone);
    fireEvent.dragOver(zone, withFiles([textFile()]));
    fireEvent.drop(zone, withFiles([textFile()]));

    expect(zone.disabled).toBe(true);
    expect(input.disabled).toBe(true);
    expect(screen.queryByRole("menuitem")).toBeNull();
    expect(onFilesSelected).not.toHaveBeenCalled();
    expect(zone.dataset.dragging).toBeUndefined();
  });

  it("passes the accept list to both inputs", () => {
    const { directory, input } = setup({ accept: ".txt,.pdf" });

    expect(input.accept).toBe(".txt,.pdf");
    expect(directory.accept).toBe(".txt,.pdf");
  });

  it("falls back to a directory input when the modern picker is unavailable", async () => {
    const { directory, onFilesSelected, zone } = setup();
    const opened = vi.spyOn(directory, "click");

    expect(directory.webkitdirectory).toBe(true);

    await openMenu(zone, /choose a folder/iv);

    await waitFor(() => {
      expect(opened).toHaveBeenCalled();
    });
    expect(onFilesSelected).not.toHaveBeenCalled();
  });
});
