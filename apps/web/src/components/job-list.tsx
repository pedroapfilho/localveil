// Safari drops list semantics from a `ul` whose bullets are removed, and these have
// none, so `role="list"` restores what the styling took away rather than repeating
// what the element already says.
/* oxlint-disable jsx-a11y/no-redundant-roles */
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

// The dot carries the same meaning as the word beside it and never on its own, so a
// reader who cannot tell the colours apart still has the label.
const STATUS_TONES: Record<JobStatus, string> = {
  done: "text-success",
  error: "text-destructive",
  queued: "text-muted-foreground",
  running: "text-foreground",
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
    <li className="flex flex-col gap-3 px-4 py-4 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="truncate text-base font-medium sm:text-sm" title={file.name}>
            {file.name}
          </p>

          <p className={`flex items-center gap-1.5 text-base sm:text-sm ${STATUS_TONES[status]}`}>
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />

            {t(STATUS_KEYS[status])}

            {inFlight && stage !== undefined ? (
              <>
                <span aria-hidden>·</span>

                <span className="text-muted-foreground truncate">{t(stage)}</span>
              </>
            ) : null}
          </p>
        </div>

        <Button
          aria-label={t("files.remove", { name: file.name })}
          className="relative shrink-0"
          onClick={handleRemove}
          size="icon-sm"
          variant="ghost"
        >
          {/* Widens the tap area to the 48px minimum on touch without moving
              anything a pointer user can see. */}
          <span
            aria-hidden
            className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
          />

          <XIcon aria-hidden />
        </Button>
      </div>

      {inFlight ? <Progress label={file.name} value={progress} /> : null}

      {summary === undefined ? null : (
        <p className="text-muted-foreground text-base tabular-nums sm:text-sm">{summary}</p>
      )}

      {status === "error" && error !== undefined ? (
        <p className="text-destructive text-base text-pretty sm:text-sm">{error}</p>
      ) : null}

      {result?.warnings.map((warning) => (
        <p
          className="text-warning-foreground bg-warning/10 rounded-lg px-3 py-2 text-base text-pretty sm:text-sm"
          key={warning}
        >
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

  // A heading over an empty box, under a dropzone that already says what to do, is a
  // second thing to read that carries nothing. The list arrives with the first file.
  if (jobs.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-medium sm:text-sm">{t("files.heading")}</h2>

        <p className="text-muted-foreground text-base tabular-nums sm:text-sm">{jobs.length}</p>
      </div>

      <ul
        aria-live="polite"
        className="ring-foreground/10 divide-foreground/5 divide-y rounded-xl ring-1"
        role="list"
      >
        {jobs.map((job) => (
          <JobRow job={job} key={job.id} onRemove={onRemove} />
        ))}
      </ul>
    </section>
  );
};

export { JobList };
export type { JobListProps };
