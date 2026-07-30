import { MessageChannel } from "node:worker_threads";

import { describe, expect, it } from "vitest";

import { createDetectClient, serialiseDetect, serveDetect } from "./detect-rpc.ts";
import type { Span } from "./types.ts";

// worker_threads gives the same MessagePort shape the browser does, so the transport
// under test here is the real one rather than a stand-in for it. The ports are passed
// straight through with no assertion, which is what proves that claim.
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

    // A port each, the way the pool hands one to every file it starts. A queue per
    // port would be a queue per file, which is what this is here to catch.
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

    // A MessagePort takes no target origin; the rule is written for the window-to-
    // window call of the same name.
    /* oxlint-disable unicorn/require-post-message-target-origin */
    server.postMessage({ hello: true });
    client.postMessage({ hello: true });
    /* oxlint-enable unicorn/require-post-message-target-origin */

    await expect(detect("Ada")).resolves.toStrictEqual([]);
  });
});
