/* oxlint-disable jsx-a11y/no-redundant-roles */
import { useTranslations } from "@repo/i18n";
import { Button } from "@repo/ui/components/button";
import { Checkbox } from "@repo/ui/components/checkbox";
import { ScrollArea } from "@repo/ui/components/scroll-area";
import { AnimatePresence } from "motion/react";
import { type CSSProperties, useState } from "react";

import type { Job } from "../store";

import { JobRow } from "./job-row";
import { JobSelectionToolbar } from "./job-selection-toolbar";

const VISIBLE_ROWS = 4;
const ROW_HEIGHT = 88;

const BLEED = 4;

const scrollStyle: CSSProperties & { "--job-list-height": string } = {
  "--job-list-height": `${String(VISIBLE_ROWS * ROW_HEIGHT + BLEED * 2)}px`,
};

type JobListProps = {
  jobs: Array<Job>;
  onApply: (id: string) => void;
  onClear: () => void;
  onCoveredChange: (id: string, covered: ReadonlyArray<string>) => void;
  onRemove: (id: string) => void;
  onRemoveMany: (ids: ReadonlyArray<string>) => void;
};

const JobList = ({
  jobs,
  onApply,
  onClear,
  onCoveredChange,
  onRemove,
  onRemoveMany,
}: JobListProps) => {
  const { t } = useTranslations();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());

  const selected = jobs.flatMap((job) => (picked.has(job.id) ? [job.id] : []));

  const handleSelect = (id: string, next: boolean) => {
    setPicked((current) => {
      const updated = new Set(current);

      if (next) {
        updated.add(id);
      } else {
        updated.delete(id);
      }

      return updated;
    });
  };

  const handleToggleAll = (next: boolean) => {
    setPicked(next ? new Set(jobs.map((job) => job.id)) : new Set());
  };

  const handleSelectAll = () => {
    handleToggleAll(true);
  };

  const handleRemoveSelected = () => {
    onRemoveMany(selected);
    setPicked(new Set());
  };

  if (jobs.length === 0) {
    return null;
  }

  const scrolls = jobs.length > VISIBLE_ROWS;
  const chosen = new Set(selected);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex min-h-9 items-center sm:min-h-8">
        {selected.length > 0 ? (
          <JobSelectionToolbar
            all={selected.length === jobs.length}
            count={selected.length}
            onRemove={handleRemoveSelected}
            onToggleAll={handleToggleAll}
          />
        ) : (
          <div className="flex w-full items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-lh items-center text-base sm:text-sm">
                <Checkbox
                  aria-label={t("files.selectAll")}
                  checked={false}
                  onCheckedChange={handleSelectAll}
                />
              </span>

              <h2 className="text-base font-medium sm:text-sm">{t("files.heading")}</h2>
            </div>

            <Button onClick={onClear} size="sm" variant="ghost">
              {t("files.clear")}
            </Button>
          </div>
        )}
      </div>

      <ScrollArea className={scrolls ? "-m-1 h-(--job-list-height)" : "-m-1"} style={scrollStyle}>
        <ul aria-live="polite" className="flex flex-col gap-2 p-1" role="list">
          <AnimatePresence initial={false}>
            {jobs.map((job, index) => (
              <JobRow
                index={index}
                job={job}
                key={job.id}
                onApply={onApply}
                onCoveredChange={onCoveredChange}
                onRemove={onRemove}
                onSelect={handleSelect}
                selected={chosen.has(job.id)}
              />
            ))}
          </AnimatePresence>
        </ul>
      </ScrollArea>
    </section>
  );
};

export { JobList };
export type { JobListProps };
