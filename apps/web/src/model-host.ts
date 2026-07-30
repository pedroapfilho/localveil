import type { ModelStageKey } from "@repo/redact-core";

import type { ConnectRequest, DisconnectRequest, ModelResponse } from "./worker-protocol";

// A worker that fails while its module is evaluating raises `error` on every attempt,
// so an uncapped respawn is an infinite create-and-terminate loop, one worker and one
// request per turn of the event loop.
const MAX_RESPAWNS = 3;

type ModelHostOptions = {
  onLost: (reason: string, fatal: boolean) => void;
  onProgress: (fraction: number, stage: ModelStageKey) => void;
};

type ModelHost = {
  connect: (channel: string, port: MessagePort) => void;
  destroy: () => void;
  disconnect: (channel: string) => void;
};

const post = (worker: Worker, message: ConnectRequest | DisconnectRequest) => {
  const transfer = message.type === "connect" ? [message.port] : [];

  // A worker's postMessage takes no target origin; the rule is written for the
  // window-to-window call of the same name.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  worker.postMessage(message, transfer);
};

// The single GLiNER session lives behind this. Everything the pool needs to know is
// how to hand it a port and when it has gone, which keeps supervision testable on its
// own and leaves the pool to schedule files.
const createModelHost = ({ onLost, onProgress }: ModelHostOptions): ModelHost => {
  let respawns = 0;
  let destroyed = false;
  let current: { listeners: AbortController; worker: Worker };

  const spawn = (): { listeners: AbortController; worker: Worker } => {
    const worker = new Worker(new URL("model-worker.ts", import.meta.url), { type: "module" });
    const listeners = new AbortController();
    const { signal } = listeners;

    const retire = (reason: string) => {
      // Without detaching, a second event from a worker already replaced runs this
      // again and takes down the files its healthy successor is serving.
      listeners.abort();
      worker.terminate();

      if (destroyed || current.worker !== worker) {
        return;
      }

      const fatal = respawns >= MAX_RESPAWNS;

      if (!fatal) {
        respawns += 1;
        current = spawn();
      }

      onLost(reason, fatal);
    };

    worker.addEventListener(
      "message",
      (event: MessageEvent<ModelResponse>) => {
        if (event.data.type !== "model-progress") {
          return;
        }

        onProgress(event.data.fraction, event.data.stage);
      },
      { signal },
    );

    worker.addEventListener(
      "error",
      () => {
        retire("The detection model stopped answering");
      },
      { signal },
    );

    // Raised instead of `error` when a reply cannot be deserialised, which leaves the
    // worker alive but out of touch, so it is retired the same way.
    worker.addEventListener(
      "messageerror",
      () => {
        retire("The detection model sent a reply that could not be read");
      },
      { signal },
    );

    return { listeners, worker };
  };

  current = spawn();

  return {
    connect: (channel, port) => {
      post(current.worker, { channel, port, type: "connect" });
    },
    destroy: () => {
      // Set before terminating: an `error` already queued would otherwise reach
      // `retire` and spawn a replacement nothing holds a reference to.
      destroyed = true;
      current.listeners.abort();
      current.worker.terminate();
    },
    disconnect: (channel) => {
      post(current.worker, { channel, type: "disconnect" });
    },
  };
};

export { createModelHost, MAX_RESPAWNS };
export type { ModelHost, ModelHostOptions };
