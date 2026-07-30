import type { MessageKey } from "@repo/i18n";
import { useTranslations } from "@repo/i18n";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@repo/ui/components/attachment";
import { Button } from "@repo/ui/components/button";
import { Progress } from "@repo/ui/components/progress";
import { ScrollArea } from "@repo/ui/components/scroll-area";
import { FileTextIcon, XIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import type { Job, JobStatus } from "../store";

const STATUS_KEYS: Record<JobStatus, MessageKey> = {
  done: "status.done",
  error: "status.error",
  queued: "status.queued",
  running: "status.running",
};

const ATTACHMENT_STATES = {
  done: "done",
  error: "error",
  queued: "idle",
  running: "processing",
} as const;

// The dot repeats the word beside it, so colour is never the only cue.
const STATUS_TONES: Record<JobStatus, string> = {
  done: "text-success",
  error: "text-destructive",
  queued: "text-muted-foreground",
  running: "text-foreground",
};

// A strong ease-out: the built-in curves are too weak to read at this duration.
const ENTER = { duration: 0.2, ease: [0.23, 1, 0.32, 1] } as const;

const VISIBLE_ROWS = 4;
const ROW_HEIGHT = 88;

// Row borders and shadows reach past the viewport edge, so without this bleed the
// scroll area slices them off at the top and bottom.
const BLEED = 4;

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
    <motion.li
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      exit={{ opacity: 0, transform: "translateY(-4px)" }}
      initial={{ opacity: 0, transform: "translateY(-6px)" }}
      layout="position"
      transition={ENTER}
    >
      <Attachment state={ATTACHMENT_STATES[status]}>
        <AttachmentMedia>
          <FileTextIcon aria-hidden className="size-4 shrink-0" />
        </AttachmentMedia>

        <AttachmentContent>
          <AttachmentTitle title={file.name}>{file.name}</AttachmentTitle>

          <AttachmentDescription className={`flex items-center gap-1.5 ${STATUS_TONES[status]}`}>
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />

            {t(STATUS_KEYS[status])}

            {inFlight && stage !== undefined ? (
              <>
                <span aria-hidden>·</span>

                <span className="text-muted-foreground truncate">{t(stage)}</span>
              </>
            ) : null}
          </AttachmentDescription>

          {inFlight ? <Progress className="mt-1.5" label={file.name} value={progress} /> : null}

          {summary === undefined ? null : (
            <AttachmentDescription className="tabular-nums">{summary}</AttachmentDescription>
          )}

          {status === "error" && error !== undefined ? (
            <AttachmentDescription className="text-destructive text-pretty">
              {error}
            </AttachmentDescription>
          ) : null}

          {result?.warnings.map((warning) => (
            <AttachmentDescription className="text-warning-foreground text-pretty" key={warning}>
              {t(warning)}
            </AttachmentDescription>
          ))}
        </AttachmentContent>

        <AttachmentActions>
          <AttachmentAction
            aria-label={t("files.remove", { name: file.name })}
            onClick={handleRemove}
          >
            <XIcon aria-hidden />
          </AttachmentAction>
        </AttachmentActions>
      </Attachment>
    </motion.li>
  );
};

type JobListProps = {
  jobs: Array<Job>;
  onClear: () => void;
  onRemove: (id: string) => void;
};

const JobList = ({ jobs, onClear, onRemove }: JobListProps) => {
  const { t } = useTranslations();

  if (jobs.length === 0) {
    return null;
  }

  const scrolls = jobs.length > VISIBLE_ROWS;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-medium sm:text-sm">{t("files.heading")}</h2>

        <div className="flex items-center gap-2">
          <p className="text-muted-foreground text-base tabular-nums sm:text-sm">{jobs.length}</p>

          <Button onClick={onClear} size="sm" variant="ghost">
            {t("files.clear")}
          </Button>
        </div>
      </div>

      <ScrollArea
        className={scrolls ? "-m-1" : "-m-1 max-h-none"}
        style={scrolls ? { maxHeight: VISIBLE_ROWS * ROW_HEIGHT + BLEED * 2 } : undefined}
        viewportClassName={scrolls ? "scroll-fade no-scrollbar p-1" : "p-1"}
      >
        <ul aria-live="polite" className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {jobs.map((job) => (
              <JobRow job={job} key={job.id} onRemove={onRemove} />
            ))}
          </AnimatePresence>
        </ul>
      </ScrollArea>
    </section>
  );
};

export { JobList };
export type { JobListProps };
