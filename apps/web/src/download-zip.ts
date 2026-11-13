import { ARCHIVE_NAME, buildZip } from "@repo/redact-core";

import type { CompletedJob } from "./store";

const entryName = ({ path, result }: CompletedJob) =>
  `${path.slice(0, path.lastIndexOf("/") + 1)}${result.name}`;

const downloadZip = async (jobs: Array<CompletedJob>) => {
  const blob = await buildZip(jobs.map((job) => ({ blob: job.result.blob, name: entryName(job) })));
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.download = ARCHIVE_NAME;
  link.href = url;
  link.click();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
};

export { downloadZip };
