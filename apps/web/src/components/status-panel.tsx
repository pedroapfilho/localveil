import type { MessageKey } from "@repo/i18n";
import { useTranslations } from "@repo/i18n";
import { Progress } from "@repo/ui/components/progress";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMemo } from "react";

import { APPEAR } from "../motion";
import type { Job } from "../store";
import { completedJobs } from "../store";
import type { ModelState } from "../use-redaction";

type StatusPanelProps = {
  jobs: Array<Job>;
  model: ModelState;
};

type Reading = { fraction: number; key: MessageKey; percent: boolean; tally: boolean };

const meanProgress = (jobs: Array<Job>) =>
  jobs.length === 0 ? 0 : jobs.reduce((sum, job) => sum + job.progress, 0) / jobs.length;

// First match wins. Two rules earn their place here: a model whose bytes are all in
// hand is building a session rather than downloading, and a queue still holding work
// outranks the model line only once the model has stopped reporting.
const read = (jobs: Array<Job>, model: ModelState): Reading => {
  const downloading = model.stage === "model.downloading";

  if (downloading && model.fraction < 1) {
    return { fraction: model.fraction, key: "model.downloading", percent: true, tally: false };
  }

  if (downloading) {
    return { fraction: 1, key: "stage.loadingModel", percent: false, tally: false };
  }

  const running = jobs.find((job) => job.status === "running");
  const waiting = running ?? jobs.find((job) => job.status === "queued");

  if (waiting !== undefined) {
    return {
      fraction: meanProgress(jobs),
      key: waiting.stage ?? "status.queued",
      percent: false,
      tally: true,
    };
  }

  if (jobs.length > 0) {
    return { fraction: 1, key: "stage.finished", percent: false, tally: true };
  }

  return { fraction: 0, key: "panel.idle", percent: false, tally: false };
};

// Always mounted and always the same height, so nothing below it moves as the state
// changes. The bar is rendered in every state, empty when resting, because a bar that
// came and went would be the reflow this box exists to remove.
const StatusPanel = ({ jobs, model }: StatusPanelProps) => {
  const { locale, t } = useTranslations();
  const reduced = useReducedMotion() ?? false;
  const reading = read(jobs, model);

  const percentFormat = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 0, style: "percent" }),
    [locale],
  );

  const tally = t("panel.progress", {
    done: completedJobs(jobs).length,
    total: jobs.length,
  });

  const slowDevice = model.slowDevice && reading.key !== "panel.idle";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        {/* The region outlives the line inside it, which is what lets each change be
            announced instead of passing silently. */}
        {/* Not animated. This line steps through eight stages per file, and a fade on
            something that changes every second or two is a flicker rather than a
            transition. */}
        <div aria-live="polite" className="min-w-0">
          <p className="text-muted-foreground text-base text-pretty sm:text-sm">{t(reading.key)}</p>
        </div>

        {reading.percent || reading.tally ? (
          <p className="text-muted-foreground shrink-0 text-base tabular-nums sm:text-sm">
            {reading.percent ? percentFormat.format(reading.fraction) : tally}
          </p>
        ) : null}
      </div>

      <Progress label={t(reading.key)} value={reading.fraction} />

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
