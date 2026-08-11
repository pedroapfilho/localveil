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
import { motion } from "motion/react";
import { useState } from "react";

import { APPEAR, staggered } from "../motion";
import type { Job, JobStatus } from "../store";
import { usesLanguage } from "../uses-language";

import { DetectionReview } from "./detection-review";
import type { DocumentLanguageChoice } from "./document-language-picker";
import { asChoice, DocumentLanguagePicker } from "./document-language-picker";
import { GlossaryText } from "./glossary-text";

const STATUS_KEYS: Record<JobStatus, MessageKey> = {
  done: "status.done",
  error: "status.error",
  queued: "status.queued",
  reviewing: "status.reviewing",
  running: "status.running",
};

const ATTACHMENT_STATES = {
  done: "done",
  error: "error",
  queued: "idle",
  reviewing: "processing",
  running: "processing",
} as const;

const STATUS_TONES: Record<JobStatus, string> = {
  done: "text-success",
  error: "text-destructive",
  queued: "text-muted-foreground",
  reviewing: "text-foreground",
  running: "text-foreground",
};

type JobRowProps = {
  index: number;
  job: Job;
  onApply: (id: string) => void;
  onDismissedChange: (id: string, dismissed: ReadonlyArray<string>) => void;
  onKeptChange: (id: string, kept: ReadonlyArray<string>) => void;
  onLanguageChange: (id: string, choice: DocumentLanguageChoice) => void;
  onRemove: (id: string) => void;
  onSelect: (id: string, selected: boolean) => void;
  selected: boolean;
};

const JobRow = ({
  index,
  job,
  onApply,
  onDismissedChange,
  onKeptChange,
  onLanguageChange,
  onRemove,
  onSelect,
  selected,
}: JobRowProps) => {
  const { t } = useTranslations();
  const { analysis, dismissed, error, file, id, kept, language, progress, result, stage, status } =
    job;

  const busy = status === "running";
  const inFlight = status === "queued" || busy;
  const languageMatters = usesLanguage(file);
  const warnings = result?.warnings ?? [];
  const failure = status === "error" && error !== undefined;
  const reviewing = status === "reviewing" && analysis !== undefined;

  const hasDetails = languageMatters || failure || reviewing || warnings.length > 0;

  const [chosen, setChosen] = useState<boolean | undefined>(undefined);
  const open = chosen ?? (failure || reviewing);

  const handleLanguageChange = (choice: DocumentLanguageChoice) => {
    onLanguageChange(id, choice);
  };

  const handleRemove = () => {
    onRemove(id);
  };

  const handleSelect = () => {
    onSelect(id, !selected);
  };

  const describeResult = () => {
    if (result === undefined) {
      return undefined;
    }

    return result.redactionCount === 0
      ? t("files.noRedactions")
      : t("files.redactions", { count: result.redactionCount });
  };

  const detail = inFlight && stage !== undefined ? t(stage) : describeResult();

  return (
    <motion.li
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
                aria-label={t("files.select", { name: file.name })}
                checked={selected}
                onChange={handleSelect}
              />
            </span>

            <AttachmentMedia>
              <FileTextIcon aria-hidden className="size-4 shrink-0" />
            </AttachmentMedia>

            <AttachmentContent>
              <AttachmentTitle title={file.name}>{file.name}</AttachmentTitle>

              <AttachmentDescription
                className={`flex items-center gap-1.5 ${STATUS_TONES[status]}`}
              >
                {busy ? (
                  <LoaderCircleIcon aria-hidden className="size-3 shrink-0 animate-spin" />
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

              {inFlight ? <Progress className="mt-1.5" label={file.name} value={progress} /> : null}
            </AttachmentContent>

            <AttachmentActions>
              {hasDetails ? (
                <CollapsibleTrigger
                  aria-label={t("files.details", { name: file.name })}
                  className="text-muted-foreground hover:text-foreground flex size-7 items-center justify-center rounded-md"
                >
                  <ChevronDownIcon
                    aria-hidden
                    className="size-4 shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] in-data-panel-open:rotate-180 motion-reduce:transition-none"
                  />
                </CollapsibleTrigger>
              ) : null}

              <AttachmentAction
                aria-label={t("files.remove", { name: file.name })}
                onClick={handleRemove}
              >
                <XIcon aria-hidden />
              </AttachmentAction>
            </AttachmentActions>
          </div>

          <CollapsiblePanel className="w-full">
            <div className="pt-3">
              <div className="border-foreground/10 flex flex-col gap-3 border-t pt-3 pl-8">
                {reviewing ? (
                  <DetectionReview
                    detections={analysis.detections}
                    dismissed={dismissed}
                    kept={kept}
                    onApply={() => {
                      onApply(id);
                    }}
                    onDismissedChange={(next) => {
                      onDismissedChange(id, next);
                    }}
                    onKeptChange={(next) => {
                      onKeptChange(id, next);
                    }}
                  />
                ) : null}

                {languageMatters ? (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-base sm:text-sm">
                      {t("dropzone.language")}
                    </span>

                    <DocumentLanguagePicker
                      onChange={handleLanguageChange}
                      value={asChoice(language)}
                    />
                  </div>
                ) : null}

                {failure ? (
                  <AttachmentDescription className="text-destructive text-pretty">
                    {error}
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
    </motion.li>
  );
};

export { JobRow };
export type { JobRowProps };
