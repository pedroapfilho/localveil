import { MessageChannel } from "node:worker_threads";

import { describe, expect, it } from "vitest";

import { createDetectClient, serialiseDetect, serveDetect } from "./detect-rpc.ts";
import type { Span } from "./types.ts";

const wire = () => {
  const channel = new MessageChannel();

  return { client: channel.port1, server: channel.port2 };
};

const span = (start: number, end: number): Span => ({
  end,
  label: "private_person",
  score: 1,
  start,
});

describe("detect RPC", () => {
  it("carries spans back to the caller", async () => {
    const { client, server } = wire();

    serveDetect(server, (text) => Promise.resolve([span(0, text.length)]));

    await expect(createDetectClient(client)("Ada")).resolves.toStrictEqual([span(0, 3)]);
  });

  it("keeps requests apart when several are in flight", async () => {
    const { client, server } = wire();

    serveDetect(server, (text) => Promise.resolve([span(text.length, text.length)]));

    const detect = createDetectClient(client);

    await expect(Promise.all([detect("a"), detect("bb"), detect("ccc")])).resolves.toStrictEqual([
      [span(1, 1)],
      [span(2, 2)],
      [span(3, 3)],
    ]);
  });

  it("runs one detection at a time across every port sharing the model", async () => {
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

    const first = wire();
    const second = wire();

    serveDetect(first.server, gated);
    serveDetect(second.server, gated);

    const detectFirst = createDetectClient(first.client);
    const detectSecond = createDetectClient(second.client);

    await Promise.all([detectFirst("a"), detectSecond("b"), detectFirst("c")]);

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

  it("rejects the caller when detection throws", async () => {
    const { client, server } = wire();

    serveDetect(server, () => Promise.reject(new Error("the session is gone")));

    await expect(createDetectClient(client)("Ada")).rejects.toThrow("the session is gone");
  });

  it("rejects everything outstanding when the far side closes", async () => {
    const { client, server } = wire();

    serveDetect(server, () => new Promise(() => {}));

    const pending = createDetectClient(client)("Ada");

    server.close();

    await expect(pending).rejects.toThrow(/closed before it answered/v);
  });

  it("leaves messages from anything else on the port alone", async () => {
    const { client, server } = wire();

    serveDetect(server, () => Promise.resolve([]));

    const detect = createDetectClient(client);

    /* oxlint-disable unicorn/require-post-message-target-origin */
    server.postMessage({ hello: true });
    client.postMessage({ hello: true });
    /* oxlint-enable unicorn/require-post-message-target-origin */

    await expect(detect("Ada")).resolves.toStrictEqual([]);
  });

  it("rejects a request issued after the far side closed, rather than hanging", async () => {
    const { client, server } = wire();

    serveDetect(server, () => Promise.resolve([]));

    const detect = createDetectClient(client);

    server.close();

    await expect(detect("Ada")).rejects.toThrow(/closed before it answered/v);
    await expect(detect("Grace")).rejects.toThrow(/closed before it answered/v);
  });
});

describe("serialiseDetect", () => {
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
