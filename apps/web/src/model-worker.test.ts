import type { ModelId } from "@repo/pii-detect/models";
/* oxlint-disable anti-slop/no-module-mocking -- @repo/pii-detect wraps a wasm model runtime; the module seam is the only practical hermetic substitute */
/* oxlint-disable anti-slop/no-unknown-parameters -- the serveDetect double mirrors the untyped MessagePort wire */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ModelRequest } from "./worker-protocol";

const detect = vi.fn(() => Promise.resolve([]));
const serveDetect = vi.fn();
const createDetector = vi.fn((_options: { model: string }) => Promise.resolve(detect));

vi.mock("@repo/pii-detect", () => ({
  createDetector: (options: { model: string }) => createDetector(options),
}));

vi.mock("@repo/redact-core", () => ({
  serveDetect: (port: unknown, served: unknown) => {
    serveDetect(port, served);
  },
}));

const loadWorkerNamed = async (name: string) => {
  const captured: Array<EventListener> = [];
  const register = vi.spyOn(globalThis, "addEventListener").mockImplementation((type, listener) => {
    if (type === "message" && typeof listener === "function") {
      captured.push(listener);
    }
  });

  self.name = name;
  vi.resetModules();

  await import("./model-worker");

  register.mockRestore();
  self.name = "";

  return captured;
};

const connectRequest = (port: MessagePort, model: ModelId = "gliner-multi-pii") =>
  new MessageEvent("message", {
    data: { channel: "a", model, port, type: "connect" } satisfies ModelRequest,
  });

afterEach(() => {
  vi.clearAllMocks();
});

describe("model worker", () => {
  it("serves a connect request on its own thread", async () => {
    const [listen] = await loadWorkerNamed("");
    const { port1, port2 } = new MessageChannel();

    listen?.(connectRequest(port2));

    expect(serveDetect.mock.calls.some(([served]) => served === port2)).toBe(true);

    port1.close();
    port2.close();
  });

  it("loads the model the connect request names, once", async () => {
    const [listen] = await loadWorkerNamed("");
    const first = new MessageChannel();
    const second = new MessageChannel();

    listen?.(connectRequest(first.port2, "gliner-pii-base"));
    listen?.(connectRequest(second.port2, "gliner-pii-base"));

    expect(createDetector.mock.calls.map(([options]) => options.model)).toEqual([
      "gliner-pii-base",
    ]);

    for (const port of [first.port1, first.port2, second.port1, second.port2]) {
      port.close();
    }
  });

  it("stands down when it comes up as an ONNX Runtime thread", async () => {
    const listeners = await loadWorkerNamed("em-pthread-3");

    expect(listeners).toHaveLength(0);
  });
});
