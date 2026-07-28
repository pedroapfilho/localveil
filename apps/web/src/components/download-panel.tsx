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

  return (
    <div className="flex flex-col items-center gap-2">
      <Button disabled={!ready} onClick={onDownload} size="lg">
        <DownloadIcon aria-hidden data-icon="inline-start" />

        {t("download.button", { count: completedJobs(jobs).length })}
      </Button>

      {ready ? null : <p className="text-muted-foreground text-sm">{t("download.waiting")}</p>}

      {excluded === 0 ? null : (
        <p className="text-muted-foreground text-sm tabular-nums">
          {t("download.excluded", { count: excluded })}
        </p>
      )}
    </div>
  );
};

export { DownloadPanel };
export type { DownloadPanelProps };
