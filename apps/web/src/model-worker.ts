import { createDetector } from "@repo/pii-detect";
import type { ModelId } from "@repo/pii-detect/models";
import { isModelId } from "@repo/pii-detect/models";
import type { Detect } from "@repo/redact-core";
import { serveDetect } from "@repo/redact-core";

import type { ModelRequest, ModelResponse } from "./worker-protocol";

const post = (message: ModelResponse) => {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker's postMessage takes no target origin
  globalThis.postMessage(message);
};

let loading: Promise<Detect> | undefined;

// A failed load has posted why, and is dropped so the next file starts afresh.
const dropIfFailed = async (started: Promise<Detect>) => {
  try {
    await started;
  } catch {
    if (loading === started) {
      loading = undefined;
    }
  }
};

// Every file shares one load, which posts each step of its lifecycle, failure included.
const loadDetector = (model: ModelId): Promise<Detect> => {
  if (loading === undefined) {
    loading = createDetector({
      model,
      onLoad: (event) => {
        post({ event, type: "model-load" });
      },
    });
    void dropIfFailed(loading);
  }

  return loading;
};

const detectWith =
  (model: ModelId): Detect =>
  async (text) => {
    const ready = await loadDetector(model);

    return ready(text);
  };

const channels = new Map<string, MessagePort>();

const hangUp = (channel: string) => {
  channels.get(channel)?.close();
  channels.delete(channel);
};

/* The host spawns one worker per model and names it after that model. ONNX Runtime's wasm threads
   load this same script under an em-pthread name, so they find no model and stand down. */
const model = isModelId(self.name) ? self.name : undefined;

if (model !== undefined) {
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

    // The load starts as a file connects, so it overlaps the reading of that file.
    void loadDetector(model);
    serveDetect(port, detectWith(model));
  });
}
