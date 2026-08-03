import { createDetector } from "@repo/pii-detect";
import type { Detect } from "@repo/redact-core";
import { serveDetect } from "@repo/redact-core";

import type { ModelRequest, ModelResponse } from "./worker-protocol";

const post = (message: ModelResponse) => {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  globalThis.postMessage(message);
};

let pendingDetector: Promise<Detect> | undefined;

const loadDetector = async () => {
  pendingDetector ??= createDetector({
    onProgress: (fraction, stage) => {
      post({ fraction, stage, type: "model-progress" });
    },
  });

  try {
    return await pendingDetector;
  } catch (error) {
    pendingDetector = undefined;

    throw error;
  }
};

const detect: Detect = async (text) => {
  const ready = await loadDetector();

  return ready(text);
};

const warmUp = async () => {
  await loadDetector().catch(() => undefined);
};

const channels = new Map<string, MessagePort>();

const hangUp = (channel: string) => {
  channels.get(channel)?.close();
  channels.delete(channel);
};

const isEmscriptenThread = self.name.startsWith("em-pthread");

if (!isEmscriptenThread) {
  globalThis.addEventListener("message", (event: MessageEvent<ModelRequest>) => {
    if (event.data.type === "disconnect") {
      hangUp(event.data.channel);

      return;
    }

    const { channel, port } = event.data;

    channels.set(channel, port);
    port.addEventListener("close", () => {
      hangUp(channel);
    });

    void warmUp();
    serveDetect(port, detect);
  });
}
