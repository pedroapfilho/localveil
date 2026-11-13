import { describe, expect, it } from "vitest";

import { failureKeyOf, RedactionFailure, unsupportedFile } from "./failure";

// What workerpool does to an error on its way out of a worker: only its own properties arrive.
const acrossAWorker = ({ message, ...own }: Error) => Object.assign(new Error(message), own);

describe("a failure's key", () => {
  it("is still readable once a worker has turned the error into a plain one", () => {
    const arrived = acrossAWorker(unsupportedFile("clip.mp4", "video/mp4"));

    expect(arrived).not.toBeInstanceOf(RedactionFailure);
    expect(failureKeyOf(arrived)).toBe("failure.unsupported");
    expect(arrived.message).toBe("clip.mp4 is not a supported file type (video/mp4)");
  });

  it("is missing from an error nobody gave one", () => {
    expect(failureKeyOf(new Error("out of memory"))).toBeUndefined();
    expect(failureKeyOf("out of memory")).toBeUndefined();
  });

  it("is not taken from an error that carries some other key", () => {
    const odd = Object.assign(new Error("odd"), { key: "failure.invented" });

    expect(failureKeyOf(odd)).toBeUndefined();
  });
});
