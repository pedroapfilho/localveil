import { useTranslations } from "@repo/i18n";
import { Progress } from "@repo/ui/components/progress";

import type { Job } from "../store";
import type { ModelState } from "../use-redaction";

import { useOverallProgress } from "./use-overall-progress";

type StatusPanelProps = {
  jobs: Array<Job>;
  model: ModelState;
};

// The bar and nothing else. The line that used to sit above it named whichever stage
// was running, and with eight stages per file it changed every second or two, which
// reads as flicker rather than as news. Every one of those names is still on the file's
// own row, next to the file it is about.
//
// Always mounted at a constant height, fading out when there is nothing to report: a
// bar sitting at zero with no work behind it reads as a job that has stalled, and
// unmounting it would hand its height back and move the footer.
const StatusPanel = ({ jobs, model }: StatusPanelProps) => {
  const { t } = useTranslations();
  const fraction = useOverallProgress(jobs, model);

  const resting = jobs.length === 0;

  return (
    <Progress
      aria-hidden={resting}
      className={`transition-opacity duration-200 ease-out ${resting ? "opacity-0" : "opacity-100"}`}
      label={t("panel.label")}
      value={fraction}
    />
  );
};

export { StatusPanel };
export type { StatusPanelProps };
