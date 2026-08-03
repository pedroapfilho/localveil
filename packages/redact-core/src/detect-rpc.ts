import { describeError } from "./describe-error.ts";
import type { Detect, Span } from "./types.ts";

type EventPort = {
  addEventListener: (type: "close" | "message", handle: (event: { data: unknown }) => void) => void;
  close: () => void;
  postMessage: (message: unknown) => void;
  start: () => void;
};

type DetectRequest = { requestId: string; text: string; type: "detect" };

type DetectResponse =
  | { message: string; requestId: string; type: "detect-error" }
  | { requestId: string; spans: Array<Span>; type: "spans" };

const isDetectRequest = (value: unknown): value is DetectRequest =>
  typeof value === "object" && value !== null && "type" in value && value.type === "detect";

const isDetectResponse = (value: unknown): value is DetectResponse =>
  typeof value === "object" &&
  value !== null &&
  "type" in value &&
  (value.type === "spans" || value.type === "detect-error");

/* oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop */
const serialiseDetect = (detect: Detect): Detect => {
  const queue: Array<{
    reject: (error: unknown) => void;
    resolve: (spans: Array<Span>) => void;
    text: string;
  }> = [];
  let draining = false;

  const drain = async () => {
    if (draining) {
      return;
    }

    draining = true;

    let next = queue.shift();

    while (next !== undefined) {
      const { reject, resolve, text } = next;

      try {
        resolve(await detect(text));
      } catch (error) {
        reject(error);
      }

      next = queue.shift();
    }

    draining = false;
  };

  return (text) =>
    new Promise((resolve, reject) => {
      queue.push({ reject, resolve, text });

      void drain();
    });
};
/* oxlint-enable eslint/no-await-in-loop, react-doctor/async-await-in-loop */

const serveDetect = (port: EventPort, detect: Detect): void => {
  const answer = async (request: DetectRequest) => {
    const { requestId, text } = request;

    try {
      const spans = await detect(text);

      port.postMessage({ requestId, spans, type: "spans" } satisfies DetectResponse);
    } catch (error) {
      port.postMessage({
        message: describeError(error),
        requestId,
        type: "detect-error",
      } satisfies DetectResponse);
    }
  };

  port.addEventListener("message", (event) => {
    const request = event.data;

    if (!isDetectRequest(request)) {
      return;
    }

    void answer(request);
  });

  port.addEventListener("close", () => {
    port.close();
  });

  port.start();
};

const createDetectClient = (port: EventPort): Detect => {
  const pending = new Map<
    string,
    { reject: (error: Error) => void; resolve: (spans: Array<Span>) => void }
  >();

  port.addEventListener("message", (event) => {
    const response = event.data;

    if (!isDetectResponse(response)) {
      return;
    }

    const waiting = pending.get(response.requestId);

    if (waiting === undefined) {
      return;
    }

    pending.delete(response.requestId);

    if (response.type === "spans") {
      waiting.resolve(response.spans);

      return;
    }

    waiting.reject(new Error(response.message));
  });

  port.addEventListener("close", () => {
    for (const waiting of pending.values()) {
      waiting.reject(new Error("The detection worker closed before it answered"));
    }

    pending.clear();
  });

  port.start();

  return (text) =>
    new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();

      pending.set(requestId, { reject, resolve });
      port.postMessage({ requestId, text, type: "detect" } satisfies DetectRequest);
    });
};

export { createDetectClient, serialiseDetect, serveDetect };
export type { DetectRequest, DetectResponse, EventPort };
