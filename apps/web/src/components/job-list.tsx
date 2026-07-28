import type { MessageKey } from "@repo/i18n";
import { useTranslations } from "@repo/i18n";
import { Button } from "@repo/ui/components/button";
import { Progress } from "@repo/ui/components/progress";
import { XIcon } from "lucide-react";

import type { Job, JobStatus } from "../store";

const STATUS_KEYS: Record<JobStatus, MessageKey> = {
  done: "status.done",
  error: "status.error",
  queued: "status.queued",
  running: "status.running",
};

const STATUS_TONES: Record<JobStatus, string> = {
  done: "text-success",
  error: "text-destructive",
  queued: "text-muted-foreground",
  running: "text-muted-foreground",
};

type JobRowProps = {
  job: Job;
  onRemove: (id: string) => void;
};

const JobRow = ({ job, onRemove }: JobRowProps) => {
  const { t } = useTranslations();
  const { error, file, progress, result, stage, status } = job;
  const inFlight = status === "queued" || status === "running";

  const handleRemove = () => {
    onRemove(job.id);
  };

  const describeResult = () => {
    if (result === undefined) {
      return undefined;
    }

    return result.redactionCount === 0
      ? t("files.noRedactions")
      : t("files.redactions", { count: result.redactionCount });
  };

  const summary = describeResult();

  return (
    <li className="border-border flex flex-col gap-2 rounded-xl border p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-sm font-medium" title={file.name}>
          {file.name}
        </p>

        <div className="flex shrink-0 items-center gap-2">
          <span className={`text-xs ${STATUS_TONES[status]}`}>{t(STATUS_KEYS[status])}</span>

          <Button
            aria-label={t("files.remove", { name: file.name })}
            onClick={handleRemove}
            size="icon-sm"
            variant="ghost"
          >
            <XIcon aria-hidden />
          </Button>
        </div>
      </div>

      {inFlight ? <Progress label={file.name} value={progress} /> : null}

      {inFlight && stage !== undefined ? (
        <p className="text-muted-foreground text-xs">{t(stage)}</p>
      ) : null}

      {summary === undefined ? null : (
        <p className="text-muted-foreground text-xs tabular-nums">{summary}</p>
      )}

      {status === "error" && error !== undefined ? (
        <p className="text-destructive text-xs">{error}</p>
      ) : null}

      {result?.warnings.map((warning) => (
        <p className="text-warning text-xs" key={warning}>
          {t(warning)}
        </p>
      ))}
    </li>
  );
};

type JobListProps = {
  jobs: Array<Job>;
  onRemove: (id: string) => void;
};

const JobList = ({ jobs, onRemove }: JobListProps) => {
  const { t } = useTranslations();

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">{t("files.heading")}</h2>

      {jobs.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("files.empty")}</p>
      ) : (
        <ul aria-live="polite" className="flex flex-col gap-2">
          {jobs.map((job) => (
            <JobRow job={job} key={job.id} onRemove={onRemove} />
          ))}
        </ul>
      )}
    </section>
  );
};

export { JobList };
export type { JobListProps };
