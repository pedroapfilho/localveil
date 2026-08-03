import { afterEach, describe, expect, it, vi } from "vitest";

import type { ModelRequest } from "./worker-protocol";

const detect = vi.fn(() => Promise.resolve([]));
const serveDetect = vi.fn();

vi.mock("@repo/pii-detect", () => ({
  createDetector: () => Promise.resolve(detect),
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

const connectRequest = (port: MessagePort) =>
  new MessageEvent("message", {
    data: { channel: "a", port, type: "connect" } satisfies ModelRequest,
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

  it("stands down when it comes up as an ONNX Runtime thread", async () => {
    const listeners = await loadWorkerNamed("em-pthread-3");

    expect(listeners).toHaveLength(0);
  });
});
