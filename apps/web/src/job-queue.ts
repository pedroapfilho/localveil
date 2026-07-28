import type { RedactRequest } from "./worker-protocol";

// Cancelling has to reach code that is several loops deep inside a redactor, and none
// of them knows what a job is. The progress callback they were all handed is the one
// thing that runs on every page, so it doubles as the checkpoint: it throws once the
// job is gone, the redactor unwinds, and no redactor had to learn anything new.
class CancelledError extends Error {
  constructor(id: string) {
    super(`Job ${id} was cancelled`);
    this.name = "CancelledError";
  }
}

type RunJob = (request: RedactRequest, stopIfCancelled: () => void) => Promise<void>;

type JobQueue = {
  cancel: (id: string) => void;
  enqueue: (request: RedactRequest) => void;
};

type JobQueueOptions = {
  onError: (request: RedactRequest, error: unknown) => void;
  run: RunJob;
};

// One file at a time: the model holds its tensors on the device, and running two
// inferences at once is how a mid-range GPU runs out of memory.
/* oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop */
const createJobQueue = ({ onError, run }: JobQueueOptions): JobQueue => {
  const queue: Array<RedactRequest> = [];
  let draining = false;
  let running: string | undefined;
  let abandoned = false;

  // Built outside the loop rather than inside it: the flag it reads has to be the one
  // the queue owns, not a copy taken when the job started.
  const checkpointFor = (id: string) => () => {
    if (abandoned) {
      throw new CancelledError(id);
    }
  };

  const drain = async () => {
    if (draining) {
      return;
    }

    draining = true;

    let next = queue.shift();

    while (next !== undefined) {
      const request = next;

      running = request.id;
      abandoned = false;

      try {
        await run(request, checkpointFor(request.id));
      } catch (error) {
        // A cancelled job has no row left on the page to report to, and reporting to
        // a row that is gone is how "Could not redact ." reached the screen.
        if (!abandoned) {
          onError(request, error);
        }
      }

      running = undefined;
      next = queue.shift();
    }

    draining = false;
  };
  /* oxlint-enable eslint/no-await-in-loop, react-doctor/async-await-in-loop */

  return {
    cancel: (id) => {
      const waiting = queue.findIndex((request) => request.id === id);

      // A file that never started leaves at once. The one that is running stops at
      // its next progress report, which for a PDF is partway through a page.
      if (waiting !== -1) {
        queue.splice(waiting, 1);

        return;
      }

      abandoned ||= id === running;
    },
    enqueue: (request) => {
      queue.push(request);

      void drain();
    },
  };
};

export { createJobQueue };
export type { JobQueue, JobQueueOptions, RunJob };
