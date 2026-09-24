import type { ModelId } from "@repo/pii-detect/models";
import { MODELS } from "@repo/pii-detect/models";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ModelEntry } from "../model-library";
import { renderWithI18n } from "../test-utils";

import type { ModelPickerProps } from "./model-picker";
import { ModelPicker } from "./model-picker";

const renderPicker = (overrides: Partial<ModelPickerProps> = {}) => {
  const props: ModelPickerProps = {
    busy: false,
    entries: {},
    models: MODELS,
    onDownload: vi.fn<(id: ModelId) => void>(),
    onOpen: vi.fn<() => void>(),
    onRemove: vi.fn<(id: ModelId) => void>(),
    onSelect: vi.fn<(id: ModelId) => void>(),
    selected: "gliner-multi-pii",
    ...overrides,
  };

  renderWithI18n(<ModelPicker {...props} />);

  return props;
};

const open = () => {
  fireEvent.click(screen.getByRole("button", { name: /detection model:/iv }));
};

const rowOf = (name: string) => {
  const row = screen.getByRole("button", { name: `Use ${name}` }).closest("li");

  if (row === null) {
    throw new Error(`${name} is not listed`);
  }

  return within(row);
};

const entries = (value: Partial<Record<ModelId, ModelEntry>>) => value;

describe("ModelPicker", () => {
  it("names the model in use on its trigger", () => {
    renderPicker({ selected: "gliner-pii-base" });

    expect(
      screen.getByRole("button", { name: "Detection model: GLiNER PII base" }),
    ).toBeInTheDocument();
  });

  it("checks what is downloaded each time it opens", () => {
    const { onOpen } = renderPicker();

    open();

    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("marks the model in use and switches when another is picked", () => {
    const { onSelect } = renderPicker();

    open();

    expect(screen.getByRole("button", { name: "Use GLiNER multi PII" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(rowOf("GLiNER multi PII").getByText("In use")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Use GLiNER PII base" }));

    expect(onSelect).toHaveBeenCalledWith("gliner-pii-base");
  });

  it("holds a switch back while files are still reaching the model", () => {
    renderPicker({ busy: true });

    open();

    expect(screen.getByRole("button", { name: "Use GLiNER PII base" })).toBeDisabled();
    expect(
      screen.getByText(/switch once the files in progress are finished/iv),
    ).toBeInTheDocument();
  });

  it("says what is downloaded, partly downloaded, or not there yet", () => {
    renderPicker({
      entries: entries({
        "gliner-multi-pii": { status: { bytes: 893_933_650, state: "ready" } },
        "gliner-pii-base": { status: { loaded: 98_000_000, state: "partial", total: 196_757_174 } },
      }),
    });

    open();

    expect(rowOf("GLiNER multi PII").getByText("Downloaded · 894 MB")).toBeInTheDocument();
    expect(
      rowOf("GLiNER PII base").getByText("Partly downloaded · 49% of 197 MB"),
    ).toBeInTheDocument();
  });

  it("offers a download for a model that is not kept, and removal for one that is", () => {
    const { onDownload, onRemove } = renderPicker({
      entries: entries({
        "gliner-multi-pii": { status: { bytes: 893_933_650, state: "ready" } },
        "gliner-pii-base": { status: { state: "absent" } },
      }),
    });

    open();

    expect(
      rowOf("GLiNER multi PII").queryByRole("button", { name: /^download/iv }),
    ).not.toBeInTheDocument();
    expect(
      rowOf("GLiNER PII base").queryByRole("button", { name: /^remove/iv }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Download GLiNER PII base" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Remove GLiNER multi PII from this browser" }),
    );

    expect(onDownload).toHaveBeenCalledWith("gliner-pii-base");
    expect(onRemove).toHaveBeenCalledWith("gliner-multi-pii");
  });

  it("shows a download under way without offering to start or remove it", () => {
    renderPicker({
      entries: entries({
        "gliner-pii-base": { progress: 0.42, status: { state: "absent" } },
      }),
    });

    open();

    const row = rowOf("GLiNER PII base");

    expect(row.getByText("Downloading · 42% of 197 MB")).toBeInTheDocument();
    expect(row.getByRole("progressbar", { name: "GLiNER PII base" })).toBeInTheDocument();
    expect(row.queryByRole("button", { name: /^download|^remove/iv })).not.toBeInTheDocument();
  });
});
