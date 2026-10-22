import { BROWSER_ACCEPT } from "@repo/redact-formats";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./app";
import { createMemoryPool } from "./memory-pool";
import { useModelLibrary } from "./model-library";
import { useJobStore } from "./store";
import { renderWithI18n } from "./test-utils";

let memory = createMemoryPool();

const renderApp = () => renderWithI18n(<App createPool={memory.create} />);

const drop = (name: string) => {
  fireEvent.change(screen.getByLabelText(/choose files/iv), {
    target: { files: [new File(["hello"], name, { type: "text/plain" })] },
  });

  const [job] = useJobStore.getState().jobs;

  assert.isDefined(job);

  return job.id;
};

describe("App", () => {
  beforeEach(() => {
    memory = createMemoryPool();
    useJobStore.setState({ jobs: [], modelLoading: false });
    useModelLibrary.setState({ entries: {}, selected: "gliner-multi-pii" });
    vi.spyOn(useModelLibrary.getState(), "refresh").mockResolvedValue();

    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the shell with nothing queued", () => {
    renderApp();

    expect(screen.getByRole("heading", { level: 1, name: "localveil" })).toBeInTheDocument();
    expect(screen.getByLabelText(/choose files/iv)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add files or folders/iv })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Files" })).toBeNull();
    expect(screen.queryByRole("button", { name: /download zip/iv })).toBeNull();
  });

  it("brings out the list and the download once a file is queued", () => {
    renderApp();

    fireEvent.change(screen.getByLabelText(/choose files/iv), {
      target: { files: [new File(["hello"], "notes.txt", { type: "text/plain" })] },
    });

    expect(screen.getByRole("heading", { name: "Files" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /download zip/iv })).toBeDisabled();
  });

  it("accepts only the formats it advertises", () => {
    renderApp();

    const input = screen.getByLabelText(/choose files/iv);

    expect(input).toHaveAttribute("accept", BROWSER_ACCEPT);
    expect(
      screen.getByText("Text, Markdown, CSV, JSON, log, PDF and image files"),
    ).toBeInTheDocument();
  });

  it("hands a dropped file to the worker and lists it", () => {
    renderApp();

    const input = screen.getByLabelText(/choose files/iv);
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });

    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText("notes.txt")).toBeInTheDocument();

    const files = within(screen.getByRole("main")).getByRole("list");

    expect(within(files).getByText("Queued")).toBeInTheDocument();
  });

  it("applies what the reader left covered in review, then offers the result", () => {
    renderApp();

    const id = drop("notes.txt");

    const detection = {
      confidence: 0.9,
      end: 8,
      label: "private_person" as const,
      preview: "Ana Lima",
      start: 0,
    };

    act(() => {
      memory.workers().onAnalysed(id, {
        detections: [
          { ...detection, id: "a" },
          { ...detection, id: "b", preview: "Joao Reis" },
        ],
        handle: undefined,
        warnings: [],
      });
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Cover Joao Reis" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply redactions" }));

    expect(memory.applied.map((request) => request.decisions)).toEqual([{ covered: ["a"] }]);

    act(() => {
      memory.workers().onDone(id, { blob: new Blob(["x"]), redactionCount: 1, warnings: [] });
    });

    expect(screen.getByRole("button", { name: /download zip/iv })).toBeEnabled();
  });

  it("says the model is loading on a waiting file only while it loads", () => {
    renderApp();
    drop("notes.txt");

    expect(screen.queryByText("Loading the detection model")).toBeNull();

    act(() => {
      memory.workers().onModelLoad({ kind: "loading" });
    });

    expect(screen.getByText("Loading the detection model")).toBeInTheDocument();
  });

  it("shows no progress bar before anything has happened", () => {
    renderApp();

    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("drops a file from the list when it is removed", async () => {
    renderApp();

    const input = screen.getByLabelText(/choose files/iv);

    fireEvent.change(input, {
      target: { files: [new File(["hello"], "notes.txt", { type: "text/plain" })] },
    });
    fireEvent.click(screen.getByLabelText("Remove notes.txt"));

    await waitFor(() => {
      expect(screen.queryByText("notes.txt")).toBeNull();
    });

    expect(screen.queryByRole("heading", { name: "Files" })).toBeNull();
  });

  it("renders in the language the browser asked for", () => {
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["pt-BR", "en-US"]);

    renderApp();

    expect(screen.getByText("Adicionar arquivos ou pastas")).toBeInTheDocument();
    expect(screen.getByText("Sobre o localveil")).toBeInTheDocument();
  });

  it("starts in the language the browser asked for, with the picker showing it", () => {
    renderApp();

    expect(screen.getByRole("combobox", { name: "Language" })).toHaveTextContent("English");
  });

  it("names every language in its own language", async () => {
    renderApp();

    fireEvent.click(screen.getByRole("combobox", { name: "Language" }));

    for (const name of ["English", "Español", "Português"]) {
      expect(await screen.findByRole("option", { name })).toBeInTheDocument();
    }
  });

  it("switches the interface when another language is picked", async () => {
    renderApp();

    fireEvent.click(screen.getByRole("combobox", { name: "Language" }));

    const option = await screen.findByRole("option", { name: "Português" });

    fireEvent.pointerDown(option);
    fireEvent.pointerUp(option);
    fireEvent.click(option);

    await waitFor(() => {
      expect(screen.getByText("Adicionar arquivos ou pastas")).toBeInTheDocument();
    });
  });
});
