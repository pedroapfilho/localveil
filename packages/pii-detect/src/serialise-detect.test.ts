import type { Span } from "@repo/redact-core";
import { describe, expect, it } from "vitest";

import { serialiseDetect } from "./serialise-detect";

const span = (start: number, end: number): Span => ({
  end,
  label: "private_person",
  score: 1,
  start,
});

describe("serialiseDetect", () => {
  it("runs one detection at a time, however many callers share the model", async () => {
    let running = 0;
    let peak = 0;

    const gated = serialiseDetect(async () => {
      running += 1;
      peak = Math.max(peak, running);

      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });

      running -= 1;

      return [];
    });

    await Promise.all([gated("a"), gated("b"), gated("c")]);

    expect(peak).toBe(1);
  });

  it("keeps a rejection on one call from poisoning the queue", async () => {
    let calls = 0;

    const gated = serialiseDetect(() => {
      calls += 1;

      return calls === 1 ? Promise.reject(new Error("first fails")) : Promise.resolve([span(0, 1)]);
    });

    await expect(gated("a")).rejects.toThrow("first fails");
    await expect(gated("b")).resolves.toStrictEqual([span(0, 1)]);
  });

  it("runs calls in the order they were made", async () => {
    const finished: Array<string> = [];
    const delays: Record<string, number> = { first: 20, second: 10, third: 0 };

    const detect = serialiseDetect(
      (text) =>
        new Promise((resolve) => {
          setTimeout(() => {
            finished.push(text);
            resolve([]);
          }, delays[text]);
        }),
    );

    await Promise.all([detect("first"), detect("second"), detect("third")]);

    expect(finished).toEqual(["first", "second", "third"]);
  });

  it("keeps a failure from poisoning the calls behind it", async () => {
    const detect = serialiseDetect((text) =>
      text === "bad" ? Promise.reject(new Error("boom")) : Promise.resolve([]),
    );

    const failing = detect("bad");
    const following = detect("good");

    await expect(failing).rejects.toThrow("boom");
    await expect(following).resolves.toStrictEqual([]);
  });

  it("rejects when the detector throws synchronously and stays usable", async () => {
    let thrown = false;

    const detect = serialiseDetect((text) => {
      if (!thrown) {
        thrown = true;

        throw new Error("synchronous");
      }

      return Promise.resolve([{ end: text.length, label: "secret" as const, score: 1, start: 0 }]);
    });

    await expect(detect("Ada")).rejects.toThrow("synchronous");
    await expect(detect("Grace")).resolves.toHaveLength(1);
  });
});
