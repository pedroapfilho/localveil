import type { ModelId, ModelLoadEvent } from "@repo/pii-detect/models";
/* oxlint-disable anti-slop/no-module-mocking -- @repo/pii-detect wraps a wasm model runtime; the module seam is the only practical hermetic substitute */
/* oxlint-disable anti-slop/no-unknown-parameters -- the serveDetect double mirrors the untyped MessagePort wire */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ModelRequest, ModelResponse } from "./worker-protocol";

type LoadOptions = { model: string; onLoad: (event: ModelLoadEvent) => void };

const detect = vi.fn(() => Promise.resolve([]));
const serveDetect = vi.fn();
const createDetector = vi.fn((_options: LoadOptions) => Promise.resolve(detect));

vi.mock("@repo/pii-detect", () => ({
  createDetector: (options: LoadOptions) => createDetector(options),
}));

vi.mock("@repo/redact-core", () => ({
  serveDetect: (port: unknown, served: unknown) => {
    serveDetect(port, served);
  },
}));

const posted: Array<ModelResponse> = [];

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

const loadWorkerFor = async (model: ModelId) => {
  const [listen] = await loadWorkerNamed(model);

  if (listen === undefined) {
    throw new Error(`The worker named ${model} took no requests`);
  }

  return listen;
};

const ports: Array<MessagePort> = [];

const connectRequest = (channel = "a") => {
  const { port1, port2 } = new MessageChannel();

  ports.push(port1, port2);

  return new MessageEvent("message", {
    data: { channel, port: port2, type: "connect" } satisfies ModelRequest,
  });
};

const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

beforeEach(() => {
  posted.length = 0;
  vi.spyOn(globalThis, "postMessage").mockImplementation((message: ModelResponse) => {
    posted.push(message);
  });
});

afterEach(() => {
  for (const port of ports) {
    port.close();
  }

  ports.length = 0;
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("model worker", () => {
  it("serves a connect request on its own thread", async () => {
    const listen = await loadWorkerFor("gliner-multi-pii");
    const request = connectRequest();

    listen(request);

    expect(serveDetect.mock.calls.some(([served]) => served === request.data.port)).toBe(true);
  });

  it("loads the model it is named after, once", async () => {
    const listen = await loadWorkerFor("gliner-pii-base");

    listen(connectRequest("a"));
    listen(connectRequest("b"));

    expect(createDetector.mock.calls.map(([options]) => options.model)).toEqual([
      "gliner-pii-base",
    ]);
  });

  it("posts each step of the load", async () => {
    createDetector.mockImplementationOnce(({ onLoad }) => {
      onLoad({ kind: "loading" });
      onLoad({ downloaded: 0.5, kind: "loading" });
      onLoad({ kind: "ready" });

      return Promise.resolve(detect);
    });
    const listen = await loadWorkerFor("gliner-multi-pii");

    listen(connectRequest());

    expect(posted).toEqual([
      { event: { kind: "loading" }, type: "model-load" },
      { event: { downloaded: 0.5, kind: "loading" }, type: "model-load" },
      { event: { kind: "ready" }, type: "model-load" },
    ]);
  });

  it("posts a failed load instead of swallowing it, and starts afresh for the next file", async () => {
    createDetector.mockImplementationOnce(({ onLoad }) => {
      onLoad({ kind: "failed", reason: "network down" });

      return Promise.reject(new Error("network down"));
    });
    const listen = await loadWorkerFor("gliner-multi-pii");

    listen(connectRequest("a"));
    await settle();
    listen(connectRequest("b"));

    expect(posted).toContainEqual({
      event: { kind: "failed", reason: "network down" },
      type: "model-load",
    });
    expect(createDetector).toHaveBeenCalledTimes(2);
  });

  it("stands down when it comes up as an ONNX Runtime thread", async () => {
    const listeners = await loadWorkerNamed("em-pthread-3");

    expect(listeners).toHaveLength(0);
  });
});
