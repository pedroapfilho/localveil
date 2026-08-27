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
import { Checkbox } from "@repo/ui/components/checkbox";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@repo/ui/components/collapsible";
import { Progress } from "@repo/ui/components/progress";
import {
  ChevronDownIcon,
  FileTextIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { m } from "motion/react";
import { useState } from "react";

import { APPEAR, staggered } from "../motion";
import type { Job, JobStatus } from "../store";
import { progressOf, stageOf } from "../store";

import { DetectionReview } from "./detection-review";
import { GlossaryText } from "./glossary-text";

const STATUS_KEYS = {
  done: "status.done",
  error: "status.error",
  queued: "status.queued",
  reviewing: "status.reviewing",
  running: "status.running",
} as const satisfies Record<JobStatus, MessageKey>;

const ATTACHMENT_STATES = {
  done: "done",
  error: "error",
  queued: "idle",
  reviewing: "processing",
  running: "processing",
} as const;

const STATUS_TONES = {
  done: "text-success",
  error: "text-destructive",
  queued: "text-muted-foreground",
  reviewing: "text-foreground",
  running: "text-foreground",
} satisfies Record<JobStatus, string>;

type JobRowProps = {
  index: number;
  job: Job;
  onApply: (id: string) => void;
  onCoveredChange: (id: string, covered: ReadonlyArray<string>) => void;
  onRemove: (id: string) => void;
  onSelect: (id: string, selected: boolean) => void;
  selected: boolean;
};

const JobRow = ({
  index,
  job,
  onApply,
  onCoveredChange,
  onRemove,
  onSelect,
  selected,
}: JobRowProps) => {
  const { t } = useTranslations();
  const { file, id, path, status } = job;
  const name = path ?? file.name;

  const busy = status === "running";
  const inFlight = status === "queued" || busy;
  const warnings = job.status === "done" ? job.result.warnings : [];
  const failure = job.status === "error";
  const reviewing = job.status === "reviewing";

  const hasDetails = failure || reviewing || warnings.length > 0;

  const [chosen, setChosen] = useState<boolean | undefined>(undefined);
  const open = chosen ?? (failure || reviewing);

  const handleRemove = () => {
    onRemove(id);
  };

  const handleSelect = () => {
    onSelect(id, !selected);
  };

  const describeResult = () => {
    if (job.status !== "done") {
      return undefined;
    }

    return job.result.redactionCount === 0
      ? t("files.noRedactions")
      : t("files.redactions", { count: job.result.redactionCount });
  };

  const stage = stageOf(job);
  const detail = inFlight && stage !== undefined ? t(stage) : describeResult();

  return (
    <m.li
      animate={{ opacity: 1, transform: "translateY(0px)", transition: staggered(index) }}
      exit={{ opacity: 0, transform: "translateY(-4px)" }}
      initial={{ opacity: 0, transform: "translateY(-6px)" }}
      layout="position"
      transition={APPEAR}
    >
      <Collapsible onOpenChange={setChosen} open={open}>
        <Attachment className="flex-col gap-0" state={ATTACHMENT_STATES[status]}>
          <div className="flex w-full gap-3">
            <span className="flex h-lh items-center text-base sm:text-sm">
              <Checkbox
                aria-label={t("files.select", { name })}
                checked={selected}
                onChange={handleSelect}
              />
            </span>

            <AttachmentMedia>
              <FileTextIcon aria-hidden className="size-4 shrink-0" />
            </AttachmentMedia>

            <AttachmentContent>
              <AttachmentTitle title={name}>{name}</AttachmentTitle>

              <AttachmentDescription
                className={`flex items-center gap-1.5 ${STATUS_TONES[status]}`}
              >
                {busy ? (
                  <LoaderCircleIcon
                    aria-hidden
                    className="size-3 shrink-0 motion-safe:animate-spin"
                  />
                ) : (
                  <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
                )}

                <span>{t(STATUS_KEYS[status])}</span>

                {detail === undefined ? null : (
                  <>
                    <span aria-hidden>·</span>

                    <span className="text-muted-foreground truncate">{detail}</span>
                  </>
                )}
              </AttachmentDescription>

              {inFlight ? (
                <Progress className="mt-1.5" label={name} value={progressOf(job)} />
              ) : null}
            </AttachmentContent>

            <AttachmentActions>
              {hasDetails ? (
                <CollapsibleTrigger
                  aria-label={t("files.details", { name })}
                  className="text-muted-foreground hover:text-foreground flex size-7 items-center justify-center rounded-md"
                >
                  <ChevronDownIcon
                    aria-hidden
                    className="size-4 shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] in-data-panel-open:rotate-180 motion-reduce:transition-none"
                  />
                </CollapsibleTrigger>
              ) : null}

              <AttachmentAction aria-label={t("files.remove", { name })} onClick={handleRemove}>
                <XIcon aria-hidden />
              </AttachmentAction>
            </AttachmentActions>
          </div>

          <CollapsiblePanel className="w-full">
            <div className="pt-3">
              <div className="border-foreground/10 flex flex-col gap-3 border-t pt-3 pl-8">
                {job.status === "reviewing" ? (
                  <DetectionReview
                    covered={job.covered}
                    detections={job.analysis.detections}
                    onApply={() => {
                      onApply(id);
                    }}
                    onCoveredChange={(next) => {
                      onCoveredChange(id, next);
                    }}
                  />
                ) : null}

                {job.status === "error" ? (
                  <AttachmentDescription className="text-destructive text-pretty">
                    {job.error}
                  </AttachmentDescription>
                ) : null}

                {warnings.map((warning) => (
                  <p
                    className="text-warning flex items-start gap-1.5 text-base text-pretty sm:text-sm"
                    key={warning}
                  >
                    <TriangleAlertIcon aria-hidden className="size-4 h-lh shrink-0" />

                    <GlossaryText>{t(warning)}</GlossaryText>
                  </p>
                ))}
              </div>
            </div>
          </CollapsiblePanel>
        </Attachment>
      </Collapsible>
    </m.li>
  );
};

export { JobRow };
export type { JobRowProps };
