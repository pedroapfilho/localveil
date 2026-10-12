import { afterEach, assert, describe, expect, it, vi } from "vitest";

import { downloadZip } from "./download-zip";
import { completedJobs } from "./store";
import { jobOf } from "./test-utils";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("downloadZip", () => {
  it("archives each finished file under its folder path and hands the archive over", async () => {
    const archives: Array<Blob | MediaSource> = [];

    vi.spyOn(URL, "createObjectURL").mockImplementation((archive) => {
      archives.push(archive);

      return "blob:localveil";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    const finished = jobOf(
      { phase: "done", result: { blob: new Blob(["redacted"]), redactionCount: 1, warnings: [] } },
      { path: "cases/august/report.txt" },
    );

    await downloadZip(completedJobs([finished]));

    const [archive] = archives;
    const [link] = click.mock.contexts;

    assert.instanceOf(archive, Blob);
    assert.instanceOf(link, HTMLAnchorElement);

    expect(new TextDecoder().decode(await archive.arrayBuffer())).toContain(
      "cases/august/report.txt",
    );
    expect(link.download).toBe("localveil.zip");
  });
});
