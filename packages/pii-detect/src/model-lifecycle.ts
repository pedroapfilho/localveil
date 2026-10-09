/* A load stays loading until it is ready or has failed. Loading carries the fraction of the weights
   downloaded only while they are arriving over the network, so a model already kept loads without
   one. A slow device is a notice rather than a state: the load carries on after it. */
type ModelLoadState =
  | { downloaded?: number; kind: "loading" }
  | { kind: "failed"; reason: string }
  | { kind: "ready" };

type ModelLoadEvent = ModelLoadState | { kind: "slow-device" };

export type { ModelLoadEvent, ModelLoadState };
