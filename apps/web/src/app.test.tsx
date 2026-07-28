import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./app";
import { useJobStore } from "./store";
import { renderWithI18n } from "./test-utils";

// jsdom ships no Worker, and the redaction worker is the one part of the page that
// cannot run here. The stub keeps the shell mountable without pretending to redact.
// It has to be a class: `new` on a plain arrow throws.
class WorkerStub {
  addEventListener = vi.fn();
  postMessage = vi.fn();
  removeEventListener = vi.fn();
  terminate = vi.fn();
}

describe("App", () => {
  beforeEach(() => {
    useJobStore.getState().reset();
    vi.stubGlobal("Worker", WorkerStub);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders the shell with nothing queued", () => {
    renderWithI18n(<App />);

    expect(screen.getByRole("heading", { level: 1, name: "localveil" })).toBeInTheDocument();
    expect(screen.getByText("No files yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /download zip/iv })).toBeDisabled();
  });

  it("accepts only the formats it advertises", () => {
    renderWithI18n(<App />);

    const input = screen.getByLabelText(/choose files/iv);

    expect(input).toHaveAttribute(
      "accept",
      ".txt,.md,.csv,.json,.log,.pdf,text/*,application/pdf,image/*",
    );
    expect(
      screen.getByText("Text, Markdown, CSV, JSON, log, PDF and image files"),
    ).toBeInTheDocument();
  });

  it("hands a dropped file to the worker and lists it", () => {
    renderWithI18n(<App />);

    const input = screen.getByLabelText(/choose files/iv);
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });

    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    expect(screen.getByText("Queued")).toBeInTheDocument();
  });

  it("drops a file from the list when it is removed", () => {
    renderWithI18n(<App />);

    const input = screen.getByLabelText(/choose files/iv);

    fireEvent.change(input, {
      target: { files: [new File(["hello"], "notes.txt", { type: "text/plain" })] },
    });
    fireEvent.click(screen.getByLabelText("Remove notes.txt"));

    expect(screen.getByText("No files yet.")).toBeInTheDocument();
  });

  it("renders in the language the browser asked for", () => {
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["pt-BR", "en-US"]);

    renderWithI18n(<App />);

    expect(screen.getByText("Arquivos")).toBeInTheDocument();
    expect(screen.getByText("Nenhum arquivo ainda.")).toBeInTheDocument();
  });

  it("offers no way to override the browser language", () => {
    renderWithI18n(<App />);

    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
