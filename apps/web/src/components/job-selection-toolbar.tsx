import { useTranslations } from "@repo/i18n";
import { Button } from "@repo/ui/components/button";
import { Checkbox } from "@repo/ui/components/checkbox";
import { TrashIcon } from "lucide-react";

type JobSelectionToolbarProps = {
  all: boolean;
  count: number;
  onRemove: () => void;
  onToggleAll: (selected: boolean) => void;
};

const JobSelectionToolbar = ({ all, count, onRemove, onToggleAll }: JobSelectionToolbarProps) => {
  const { t } = useTranslations();

  const handleToggleAll = () => {
    onToggleAll(!all);
  };

  return (
    <div className="flex w-full items-center gap-3">
      <span className="flex h-lh items-center text-base sm:text-sm">
        <Checkbox
          aria-label={t("files.selectAll")}
          checked={all}
          indeterminate={!all}
          onChange={handleToggleAll}
        />
      </span>

      <p className="truncate text-base font-medium tabular-nums sm:text-sm">
        {t("files.selected", { count })}
      </p>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Button
          aria-label={t("files.removeSelected")}
          className="relative"
          onClick={onRemove}
          variant="destructive"
        >
          <TrashIcon aria-hidden data-icon="inline-start" />

          <span className="max-sm:hidden">{t("files.removeSelected")}</span>

          <span
            aria-hidden
            className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
          />
        </Button>
      </div>
    </div>
  );
};

export { JobSelectionToolbar };
export type { JobSelectionToolbarProps };
