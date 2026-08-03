import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./app";
import { useJobStore } from "./store";
import { renderWithI18n } from "./test-utils";

vi.mock("./worker-pool", () => ({
  createRedactionPool: () => ({ cancel: vi.fn(), destroy: vi.fn(), submit: vi.fn() }),
}));

describe("App", () => {
  beforeEach(() => {
    useJobStore.getState().reset();

    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

    const files = within(screen.getByRole("main")).getByRole("list");

    expect(within(files).getByText("Queued")).toBeInTheDocument();
  });

  it("shows no progress bar before anything has happened", () => {
    renderWithI18n(<App />);

    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("drops a file from the list when it is removed", async () => {
    renderWithI18n(<App />);

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

    fireEvent.pointerDown(option);
    fireEvent.pointerUp(option);
    fireEvent.click(option);

    await waitFor(() => {
      expect(screen.getByText("Escolher arquivos")).toBeInTheDocument();
    });
  });
});
