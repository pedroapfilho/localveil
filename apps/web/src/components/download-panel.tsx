import { useTranslations } from "@repo/i18n";
import { Button } from "@repo/ui/components/button";
import { DownloadIcon } from "lucide-react";

import type { Job } from "../store";
import { completedJobs, failedJobs, hasCompletedJobs } from "../store";

type DownloadPanelProps = {
  jobs: Array<Job>;
  onDownload: () => void;
};

const DownloadPanel = ({ jobs, onDownload }: DownloadPanelProps) => {
  const { t } = useTranslations();

  const ready = hasCompletedJobs(jobs);
  const excluded = failedJobs(jobs).length;

  // A disabled button counting nothing is the loudest thing on an empty page. It
  // appears with the first file, which is the first moment it could ever be pressed.
  if (jobs.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <Button
        className="focus-visible:outline-ring w-full focus-visible:outline-2 focus-visible:outline-offset-2 sm:w-auto"
        disabled={!ready}
        onClick={onDownload}
        size="lg"
      >
        <DownloadIcon aria-hidden data-icon="inline-start" />

        {t("download.button", { count: completedJobs(jobs).length })}
      </Button>

      {ready ? null : (
        <p className="text-muted-foreground text-base text-pretty sm:text-sm">
          {t("download.waiting")}
        </p>
      )}

      {excluded === 0 ? null : (
        <p className="text-muted-foreground text-base text-pretty tabular-nums sm:text-sm">
          {t("download.excluded", { count: excluded })}
        </p>
      )}
    </div>
  );
};

export { DownloadPanel };
export type { DownloadPanelProps };
