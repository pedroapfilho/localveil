import type { ModelStageKey } from "@repo/redact-core";

import type { ConnectRequest, DisconnectRequest, ModelResponse } from "./worker-protocol";

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

  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  worker.postMessage(message, transfer);
};

const createModelHost = ({ onLost, onProgress }: ModelHostOptions): ModelHost => {
  let respawns = 0;
  let destroyed = false;
  let current: { listeners: AbortController; worker: Worker };

  const spawn = (): { listeners: AbortController; worker: Worker } => {
    const worker = new Worker(new URL("model-worker.ts", import.meta.url), { type: "module" });
    const listeners = new AbortController();
    const { signal } = listeners;

    const retire = (reason: string) => {
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
