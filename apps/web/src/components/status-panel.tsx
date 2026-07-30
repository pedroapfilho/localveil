import type { MessageKey } from "@repo/i18n";
import { useTranslations } from "@repo/i18n";
import { Progress } from "@repo/ui/components/progress";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMemo } from "react";

import { APPEAR } from "../motion";
import type { Job } from "../store";
import { completedJobs } from "../store";
import type { ModelState } from "../use-redaction";

import { useOverallProgress } from "./use-overall-progress";

type StatusPanelProps = {
  jobs: Array<Job>;
  model: ModelState;
};

type Trailing = "none" | "percent" | "tally";

type Reading = { key: MessageKey; resting: boolean; trailing: Trailing };

// What the panel is saying, which is separate from how far along it is: the bar is one
// sweep over the whole job, and this is the name of whichever part of it is happening
// now. First match wins, and a model whose bytes are all in hand is building a session
// rather than downloading.
const read = (jobs: Array<Job>, model: ModelState): Reading => {
  const downloading = model.stage === "model.downloading";
  const working = jobs.find((job) => job.status === "running" || job.status === "queued");

  if (downloading && working !== undefined) {
    return {
      key: model.fraction < 1 ? "model.downloading" : "stage.loadingModel",
      resting: false,
      trailing: "percent",
    };
  }

  if (working !== undefined) {
    return { key: working.stage ?? "status.queued", resting: false, trailing: "percent" };
  }

  if (jobs.length > 0) {
    return { key: "stage.finished", resting: false, trailing: "tally" };
  }

  return { key: "panel.idle", resting: true, trailing: "none" };
};

// Always mounted and always the same height, so nothing below it moves as the state
// changes. At rest the track fades out rather than unmounting: a bar sitting at zero
// with nothing happening reads as a job that has stalled, and removing it outright
// would give back the height this box exists to hold.
const StatusPanel = ({ jobs, model }: StatusPanelProps) => {
  const { locale, t } = useTranslations();
  const reduced = useReducedMotion() ?? false;
  const reading = read(jobs, model);
  const fraction = useOverallProgress(jobs, model);

  const percentFormat = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 0, style: "percent" }),
    [locale],
  );

  const trailing = () => {
    if (reading.trailing === "percent") {
      return percentFormat.format(fraction);
    }

    return t("panel.progress", { done: completedJobs(jobs).length, total: jobs.length });
  };

  const slowDevice = model.slowDevice && !reading.resting;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        {/* The region outlives the line inside it, which is what lets each change be
            announced instead of passing silently. Not animated: this line steps through
            eight stages per file, and a fade on something that changes every second or
            two is a flicker rather than a transition. */}
        <div aria-live="polite" className="min-w-0">
          <p className="text-muted-foreground text-base text-pretty sm:text-sm">{t(reading.key)}</p>
        </div>

        {reading.trailing === "none" ? null : (
          <p className="text-muted-foreground shrink-0 text-base tabular-nums sm:text-sm">
            {trailing()}
          </p>
        )}
      </div>

      <Progress
        className={`transition-opacity duration-200 ease-out ${reading.resting ? "opacity-0" : "opacity-100"}`}
        label={t(reading.key)}
        value={fraction}
      />

      {/* Reduced motion drops the height, which is the part that travels, and keeps the
          fade, which is the part that explains where the line came from. Zeroing the
          duration instead would remove both. */}
      <AnimatePresence initial={false}>
        {slowDevice ? (
          <motion.div
            animate={reduced ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            className="overflow-hidden"
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={APPEAR}
          >
            <p className="text-muted-foreground text-base text-pretty sm:text-sm">
              {t("model.slowDevice")}
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
};

export { StatusPanel };
export type { StatusPanelProps };
