import { buildZip } from "@repo/redact-core";

import type { CompletedJob } from "./store";

const ZIP_NAME = "localveil.zip";

const downloadZip = async (jobs: Array<CompletedJob>) => {
  const blob = await buildZip(jobs.map((job) => ({ blob: job.result.blob, name: job.path })));
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.download = ZIP_NAME;
  link.href = url;
  link.click();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
};

export { downloadZip };
