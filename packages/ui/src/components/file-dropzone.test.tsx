import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FileDropzone } from "./file-dropzone";

const textFile = (name = "notes.txt") => new File(["hello"], name, { type: "text/plain" });

const withFiles = (files: Array<File>) => ({
  dataTransfer: { files, items: [], types: ["Files"] },
});

const setup = (props: Partial<Parameters<typeof FileDropzone>[0]> = {}) => {
  const onFilesSelected = vi.fn<(files: Array<{ file: File; path: string }>) => void>();

  render(
    <FileDropzone
      hint="or drag and drop them here"
      label="Choose files"
      onFilesSelected={onFilesSelected}
      {...props}
    />,
  );

  const input = screen.getByLabelText(/choose files/iv);

  if (!(input instanceof HTMLInputElement)) {
    throw new TypeError("The labelled control is not a file input");
  }

  const zone = input.closest("[data-slot=file-dropzone]");

  if (!(zone instanceof HTMLLabelElement)) {
    throw new TypeError("The file input is not inside the dropzone label");
  }

  return { input, onFilesSelected, zone };
};

describe("FileDropzone", () => {
  it("opens the picker when the zone is clicked", () => {
    const { input, zone } = setup();
    const opened = vi.fn<() => void>();

    input.addEventListener("click", opened);
    fireEvent.click(zone);

    expect(opened).toHaveBeenCalled();
  });

  it("keeps the input reachable by keyboard so Enter and Space open the picker", () => {
    const { input } = setup();

    expect(input.disabled).toBe(false);
    expect(input.tabIndex).toBe(0);
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
    const opened = vi.fn<() => void>();

    input.addEventListener("click", opened);
    fireEvent.click(zone);
    fireEvent.dragOver(zone, withFiles([textFile()]));
    fireEvent.drop(zone, withFiles([textFile()]));

    expect(input.disabled).toBe(true);
    expect(opened).not.toHaveBeenCalled();
    expect(onFilesSelected).not.toHaveBeenCalled();
    expect(zone.dataset.dragging).toBeUndefined();
  });

  it("passes the accept list to the input", () => {
    const { input } = setup({ accept: ".txt,.pdf" });

    expect(input.accept).toBe(".txt,.pdf");
  });

  it("falls back to a directory input when the modern picker is unavailable", async () => {
    const { onFilesSelected } = setup({ folderLabel: "Choose a folder" });
    const directory = document.querySelectorAll('input[type="file"]')[1];

    if (!(directory instanceof HTMLInputElement)) {
      throw new TypeError("The directory fallback input was not rendered");
    }

    const opened = vi.spyOn(directory, "click");

    expect(directory.webkitdirectory).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Choose a folder" }));

    await waitFor(() => {
      expect(opened).toHaveBeenCalled();
    });
    expect(onFilesSelected).not.toHaveBeenCalled();
  });
});
