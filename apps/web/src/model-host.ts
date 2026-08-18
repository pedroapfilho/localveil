import type { ModelStageKey } from "@repo/redact-core";

import type { ConnectRequest, DisconnectRequest, ModelResponse } from "./worker-protocol";

const MAX_RESPAWNS = 3;

type ModelHostOptions = {
  onLost: (reason: string, fatal: boolean) => void;
  onProgress: (fraction: number, stage: ModelStageKey) => void;
};

type ModelHost = {
  connect: (channel: string, port: MessagePort) => boolean;
  destroy: () => void;
  disconnect: (channel: string) => void;
};

type HostState =
  | { kind: "gone" }
  | { kind: "live"; listeners: AbortController; respawns: number; worker: Worker };

const post = (worker: Worker, message: ConnectRequest | DisconnectRequest) => {
  const transfer = message.type === "connect" ? [message.port] : [];

  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  worker.postMessage(message, transfer);
};

const createModelHost = ({ onLost, onProgress }: ModelHostOptions): ModelHost => {
  let state: HostState = { kind: "gone" };

  const spawn = (respawns: number): HostState => {
    const worker = new Worker(new URL("model-worker.ts", import.meta.url), { type: "module" });
    const listeners = new AbortController();
    const { signal } = listeners;

    const retire = (reason: string) => {
      listeners.abort();
      worker.terminate();

      if (state.kind !== "live" || state.worker !== worker) {
        return;
      }

      const fatal = respawns >= MAX_RESPAWNS;

      state = fatal ? { kind: "gone" } : spawn(respawns + 1);

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

    return { kind: "live", listeners, respawns, worker };
  };

  state = spawn(0);

  return {
    connect: (channel, port) => {
      if (state.kind !== "live") {
        return false;
      }

      post(state.worker, { channel, port, type: "connect" });

      return true;
    },
    destroy: () => {
      if (state.kind !== "live") {
        return;
      }

      state.listeners.abort();
      state.worker.terminate();
      state = { kind: "gone" };
    },
    disconnect: (channel) => {
      if (state.kind !== "live") {
        return;
      }

      post(state.worker, { channel, type: "disconnect" });
    },
  };
};

export { createModelHost, MAX_RESPAWNS };
export type { ModelHost, ModelHostOptions };
