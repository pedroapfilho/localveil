import { afterEach, assert, describe, expect, it, vi } from "vitest";

import { downloadZip } from "./download-zip";
import { completedJobs } from "./store";
import { jobOf } from "./test-utils";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("downloadZip", () => {
  it("archives each finished file under its folder path and the name its redactor gave it", async () => {
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
      {
        phase: "done",
        result: {
          blob: new Blob(["redacted"]),
          name: "scan.png",
          redactionCount: 1,
          warnings: [],
        },
      },
      { path: "cases/august/scan.gif" },
    );

    await downloadZip(completedJobs([finished]));

    const [archive] = archives;
    const [link] = click.mock.contexts;

    assert.instanceOf(archive, Blob);
    assert.instanceOf(link, HTMLAnchorElement);

    const listing = new TextDecoder().decode(await archive.arrayBuffer());

    expect(listing).toContain("cases/august/scan.png");
    expect(listing).not.toContain("scan.gif");
    expect(link.download).toBe("localveil.zip");
  });
});
