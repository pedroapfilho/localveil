import { createDetector } from "@repo/pii-detect";
import type { ModelId } from "@repo/pii-detect";
import type { Detect } from "@repo/redact-core";
import { serveDetect } from "@repo/redact-core";

import type { ModelRequest, ModelResponse } from "./worker-protocol";

const post = (message: ModelResponse) => {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  globalThis.postMessage(message);
};

/* The host spawns one worker per model and replaces it on a switch, so a second model here would
   only come from a stale connect; it still gets the model it asked for rather than the wrong one. */
let pending: { detector: Promise<Detect>; model: ModelId } | undefined;

const loadDetector = async (model: ModelId) => {
  if (pending?.model !== model) {
    pending = {
      detector: createDetector({
        model,
        onProgress: (fraction, stage) => {
          post({ fraction, stage, type: "model-progress" });
        },
      }),
      model,
    };
  }

  const loading = pending;

  try {
    return await loading.detector;
  } catch (error) {
    if (pending === loading) {
      pending = undefined;
    }

    throw error;
  }
};

const detectWith =
  (model: ModelId): Detect =>
  async (text) => {
    const ready = await loadDetector(model);

    return ready(text);
  };

const warmUp = async (model: ModelId) => {
  await loadDetector(model).catch(() => undefined);
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

    const { channel, model, port } = event.data;

    channels.set(channel, port);
    port.addEventListener("close", () => {
      hangUp(channel);
    });

    void warmUp(model);
    serveDetect(port, detectWith(model));
  });
}
