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

  // Nothing but the dropzone and the footer until a file arrives: no file list over
  // an empty box, no download button counting nothing.
  it("renders the shell with nothing queued", () => {
    renderWithI18n(<App />);

    expect(screen.getByRole("heading", { level: 1, name: "localveil" })).toBeInTheDocument();
    expect(screen.getByLabelText(/choose files/iv)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Files" })).toBeNull();
    expect(screen.queryByRole("button", { name: /download zip/iv })).toBeNull();
  });

  it("brings out the list and the download once a file is queued", () => {
    renderWithI18n(<App />);

    fireEvent.change(screen.getByLabelText(/choose files/iv), {
      target: { files: [new File(["hello"], "notes.txt", { type: "text/plain" })] },
    });

    expect(screen.getByRole("heading", { name: "Files" })).toBeInTheDocument();
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

    expect(screen.queryByText("notes.txt")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Files" })).toBeNull();
  });

  it("renders in the language the browser asked for", () => {
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["pt-BR", "en-US"]);

    renderWithI18n(<App />);

    expect(screen.getByText("Escolher arquivos")).toBeInTheDocument();
    expect(screen.getByText("Sobre o localveil")).toBeInTheDocument();
  });

  it("offers no way to override the browser language", () => {
    renderWithI18n(<App />);

    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
