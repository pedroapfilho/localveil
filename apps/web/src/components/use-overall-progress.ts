import { useState } from "react";

import type { Job } from "../store";
import type { ModelState } from "../use-redaction";

type Batch = { busy: boolean; countsModel: boolean };

const IDLE: Batch = { busy: false, countsModel: false };

// One sweep from empty to full for the whole job, rather than one sweep for the model
// download and a second for the files behind it. The model is counted as one more unit
// of work alongside each file, so a download that takes minutes and a redaction that
// takes seconds both push the same bar forward and it never restarts.
//
// The model only joins the total for a batch that actually waits on it. A batch dropped
// once the model is ready would otherwise open half full, having been credited for work
// that happened before the reader asked for anything.
const useOverallProgress = (jobs: Array<Job>, model: ModelState) => {
  const [batch, setBatch] = useState<Batch>(IDLE);

  const queued = jobs.length > 0;
  const starting = queued && !batch.busy;

  // Read locally rather than from state, so the render that starts a batch already uses
  // the answer instead of the one left over from the batch before it.
  const countsModel = starting ? model.stage !== "model.ready" : batch.countsModel;

  if (queued !== batch.busy) {
    setBatch({ busy: queued, countsModel });
  }

  if (!queued) {
    return 0;
  }

  // Counted as finished once the model is ready rather than read off the fraction: the
  // last progress message and the ready message are two separate posts, and the gap
  // between them would otherwise show as the bar stalling a hair short.
  const modelDone = model.stage === "model.ready" ? 1 : model.fraction;
  const done = jobs.reduce((sum, job) => sum + job.progress, 0);

  if (!countsModel) {
    return Math.min(1, done / jobs.length);
  }

  return Math.min(1, (done + modelDone) / (jobs.length + 1));
};

export { useOverallProgress };
