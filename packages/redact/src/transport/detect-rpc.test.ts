import { MessageChannel } from "node:worker_threads";

import type { Span } from "@repo/redact-core";
import { describe, expect, it } from "vitest";

import { createDetectClient, serveDetect } from "./detect-rpc";

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

    /* oxlint-disable unicorn/require-post-message-target-origin -- MessagePort.postMessage takes no target origin */
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
