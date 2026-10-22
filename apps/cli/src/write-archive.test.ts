/* oxlint-disable anti-slop/no-module-mocking -- inject syscall failures while keeping real staging and hard-link publication */
import type * as FsPromises from "node:fs/promises";
import { link, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeArchive } from "./write-archive";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();

  return { ...actual, link: vi.fn(actual.link) };
});

let directory = "";

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "localveil-archive-"));
});

afterEach(async () => {
  vi.mocked(link).mockClear();
  await rm(directory, { force: true, recursive: true });
});

describe("writeArchive", () => {
  it("publishes simultaneous archives without replacing either set of bytes", async () => {
    const signal = new AbortController().signal;
    const contents = ["first archive", "second archive"];

    const paths = await Promise.all(
      contents.map((text) => writeArchive(new Blob([text]), directory, signal)),
    );

    expect(new Set(paths).size).toBe(2);
    await expect(Promise.all(paths.map((file) => readFile(file, "utf8")))).resolves.toEqual(
      contents,
    );
    const left = await readdir(directory);

    expect(left.toSorted()).toEqual(["localveil (2).zip", "localveil.zip"]);
  });

  it("removes its staged bytes when publication fails", async () => {
    vi.mocked(link).mockRejectedValueOnce(
      Object.assign(new Error("disk failure"), { code: "EIO" }),
    );

    await expect(
      writeArchive(new Blob(["bytes"]), directory, new AbortController().signal),
    ).rejects.toThrow("disk failure");
    expect(await readdir(directory)).toEqual([]);
  });

  it("removes its staged bytes when cancelled before a collision retry", async () => {
    const controller = new AbortController();

    vi.mocked(link).mockImplementationOnce(() => {
      controller.abort();

      return Promise.reject(Object.assign(new Error("collision"), { code: "EEXIST" }));
    });

    await expect(
      writeArchive(new Blob(["bytes"]), directory, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(await readdir(directory)).toEqual([]);
  });

  it("writes nothing when already cancelled", async () => {
    await expect(
      writeArchive(new Blob(["bytes"]), directory, AbortSignal.abort()),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(await readdir(directory)).toEqual([]);
  });
});
