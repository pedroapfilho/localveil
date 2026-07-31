import { createDetector } from "@repo/pii-detect";
import type { Detect } from "@repo/redact-core";
import { serveDetect } from "@repo/redact-core";

import type { ModelRequest, ModelResponse } from "./worker-protocol";

const post = (message: ModelResponse) => {
  // A worker's own postMessage takes no target origin; the rule is written for the
  // window-to-window call of the same name.
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
    // A failed load is worth retrying on the next file: a cached rejection would
    // condemn every later job to the same error.
    pendingDetector = undefined;

    throw error;
  }
};

// createDetector serialises what it returns, so every file sharing this worker shares
// one queue into the session.
const detect: Detect = async (text) => {
  const ready = await loadDetector();

  return ready(text);
};

// Started when a file connects rather than when it first asks for a score: the worker
// spends seconds rendering and recognising page one, and the weights can download
// through all of it.
const warmUp = async () => {
  try {
    await loadDetector();
  } catch {
    // Swallowed here alone. `detect` loads again rather than caching this rejection,
    // so the failure still reaches the file that asked for a score.
  }
};

// Held so a job cancelled before any worker received its half can still be hung up
// on. A port the far end never closes is a port this worker would keep forever.
const channels = new Map<string, MessagePort>();

const hangUp = (channel: string) => {
  channels.get(channel)?.close();
  channels.delete(channel);
};

// ONNX Runtime starts its wasm threads by loading the module it was bundled into,
// which is this file, so a copy of everything here comes back up inside each of them.
// That copy is emscripten's thread and not a second model host: what it receives on
// this global is emscripten's own load command, which has no port on it, and reading
// one off it throws where the page can only see the model worker die. emscripten
// names those threads, and the name is the one thing that tells them apart.
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
