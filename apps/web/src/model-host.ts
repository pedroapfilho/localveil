import type { ModelId, ModelLoadEvent } from "@repo/pii-detect/models";
import type { FailureKey } from "@repo/redact";

import type { ConnectRequest, DisconnectRequest, ModelResponse } from "./worker-protocol";

const MAX_RESPAWNS = 3;

type ModelHostOptions = {
  model: ModelId;
  onLoad: (event: ModelLoadEvent) => void;
  onLost: (failure: FailureKey, fatal: boolean) => void;
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

  worker.postMessage(message, transfer);
};

const createModelHost = ({ model, onLoad, onLost }: ModelHostOptions): ModelHost => {
  let state: HostState = { kind: "gone" };

  const spawn = (respawns: number): HostState => {
    const worker = new Worker(new URL("model-worker.ts", import.meta.url), {
      name: model,
      type: "module",
    });

    const listeners = new AbortController();
    const { signal } = listeners;

    const retire = (failure: FailureKey) => {
      listeners.abort();
      worker.terminate();

      if (state.kind !== "live" || state.worker !== worker) {
        return;
      }

      const fatal = respawns >= MAX_RESPAWNS;

      state = fatal ? { kind: "gone" } : spawn(respawns + 1);

      onLost(failure, fatal);
    };

    worker.addEventListener(
      "message",
      (event: MessageEvent<ModelResponse>) => {
        onLoad(event.data.event);
      },
      { signal },
    );

    worker.addEventListener(
      "error",
      () => {
        retire("failure.modelSilent");
      },
      { signal },
    );

    worker.addEventListener(
      "messageerror",
      () => {
        retire("failure.modelUnreadable");
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
