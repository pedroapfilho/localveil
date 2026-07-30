import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./app";
import { useJobStore } from "./store";
import { renderWithI18n } from "./test-utils";
import type { WorkerResponse } from "./worker-protocol";

type Reply = (event: { data: WorkerResponse }) => void;

const workers: Array<WorkerStub> = [];

// jsdom ships no Worker, and the redaction worker is the one part of the page that
// cannot run here. The stub keeps the shell mountable without pretending to redact,
// and holds the page's listeners so a test can answer the way the worker would.
// It has to be a class: `new` on a plain arrow throws.
class WorkerStub {
  handlers = new Map<string, Reply>();

  addEventListener = vi.fn((name: string, handler: Reply) => {
    this.handlers.set(name, handler);
  });

  postMessage = vi.fn();
  removeEventListener = vi.fn();
  terminate = vi.fn();

  constructor() {
    workers.push(this);
  }
}

describe("App", () => {
  beforeEach(() => {
    workers.length = 0;
    useJobStore.getState().reset();
    // The picker remembers the choice, so a test that switches language would
    // otherwise decide the language of every test that follows it.
    localStorage.clear();
    vi.stubGlobal("Worker", WorkerStub);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

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
    // Scoped to the file list: the status panel reports the same state at the same
    // time, which is the point of having it.
    const files = within(screen.getByRole("main")).getByRole("list");

    expect(within(files).getByText("Queued")).toBeInTheDocument();
  });

  // The panel is reserved from first paint so that nothing below it moves as the state
  // changes, which is the reason it reports at rest rather than appearing on demand.
  it("holds the status panel open before anything has happened", () => {
    renderWithI18n(<App />);

    expect(screen.getByText("Nothing running")).toBeInTheDocument();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
  });

  it("reports the model download in the panel it already has", () => {
    renderWithI18n(<App />);

    fireEvent.change(screen.getByLabelText(/choose files/iv), {
      target: { files: [new File(["hello"], "notes.txt", { type: "text/plain" })] },
    });

    act(() => {
      workers[0].handlers.get("message")?.({
        data: { fraction: 0.5, stage: "model.downloading", type: "model-progress" },
      });
    });

    expect(screen.getByText("Downloading the detection model")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("drops a file from the list when it is removed", async () => {
    renderWithI18n(<App />);

    const input = screen.getByLabelText(/choose files/iv);

    fireEvent.change(input, {
      target: { files: [new File(["hello"], "notes.txt", { type: "text/plain" })] },
    });
    fireEvent.click(screen.getByLabelText("Remove notes.txt"));

    // The row plays its way out before it goes, so the assertion waits for the
    // animation rather than racing it.
    await waitFor(() => {
      expect(screen.queryByText("notes.txt")).toBeNull();
    });

    expect(screen.queryByRole("heading", { name: "Files" })).toBeNull();
  });

  it("renders in the language the browser asked for", () => {
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["pt-BR", "en-US"]);

    renderWithI18n(<App />);

    expect(screen.getByText("Escolher arquivos")).toBeInTheDocument();
    expect(screen.getByText("Sobre o localveil")).toBeInTheDocument();
  });

  it("starts in the language the browser asked for, with the picker showing it", () => {
    renderWithI18n(<App />);

    expect(screen.getByRole("combobox", { name: "Language" })).toHaveTextContent("English");
  });

  it("names every language in its own language", async () => {
    renderWithI18n(<App />);

    fireEvent.click(screen.getByRole("combobox", { name: "Language" }));

    for (const name of ["English", "Español", "Português"]) {
      // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop
      expect(await screen.findByRole("option", { name })).toBeInTheDocument();
    }
  });

  it("switches the interface when another language is picked", async () => {
    renderWithI18n(<App />);

    fireEvent.click(screen.getByRole("combobox", { name: "Language" }));

    const option = await screen.findByRole("option", { name: "Português" });

    // The full pointer sequence, not a bare click: the menu commits its choice on
    // pointer-up, the way a real one has to so a drag off the list can cancel.
    fireEvent.pointerDown(option);
    fireEvent.pointerUp(option);
    fireEvent.click(option);

    await waitFor(() => {
      expect(screen.getByText("Escolher arquivos")).toBeInTheDocument();
    });
  });
});
