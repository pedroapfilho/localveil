import { describeError } from "./describe-error";
import type { Detect, Span } from "./types";

type EventPort = {
  addEventListener: (type: "close" | "message", handle: (event: { data: unknown }) => void) => void;
  close: () => void;
  postMessage: (message: DetectRequest | DetectResponse) => void;
  start: () => void;
};

type DetectRequest = { requestId: string; text: string; type: "detect" };

type DetectResponse =
  | { message: string; requestId: string; type: "detect-error" }
  | { requestId: string; spans: Array<Span>; type: "spans" };

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the wire boundary: MessagePort delivers untyped data and this guard is its parser
const isDetectRequest = (value: unknown): value is DetectRequest =>
  typeof value === "object" && value !== null && "type" in value && value.type === "detect";

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the wire boundary: MessagePort delivers untyped data and this guard is its parser
const isDetectResponse = (value: unknown): value is DetectResponse =>
  typeof value === "object" &&
  value !== null &&
  "type" in value &&
  (value.type === "spans" || value.type === "detect-error");

const serialiseDetect = (detect: Detect): Detect => {
  let tail: Promise<unknown> = Promise.resolve();

  return (text) => {
    /* oxlint-disable-next-line promise/prefer-await-to-then -- the chain is the queue: awaiting
       here would need an externally settled promise per call, which is what this replaced. */
    const spans = tail.then(() => detect(text));

    // oxlint-disable-next-line promise/prefer-await-to-then
    tail = spans.catch(() => {});

    return spans;
  };
};

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

const CLOSED_EARLY = "The detection worker closed before it answered";

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

  let closed = false;

  port.addEventListener("close", () => {
    closed = true;

    for (const waiting of pending.values()) {
      waiting.reject(new Error(CLOSED_EARLY));
    }

    pending.clear();
  });

  port.start();

  return (text) => {
    if (closed) {
      return Promise.reject(new Error(CLOSED_EARLY));
    }

    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();

      pending.set(requestId, { reject, resolve });
      port.postMessage({ requestId, text, type: "detect" } satisfies DetectRequest);
    });
  };
};

export { createDetectClient, serialiseDetect, serveDetect };
export type { DetectRequest, DetectResponse, EventPort };
