import { useTranslations } from "@repo/i18n";
import { Button } from "@repo/ui/components/button";
import { Checkbox } from "@repo/ui/components/checkbox";

import type { DocumentLanguageChoice } from "./document-language-picker";
import { DocumentLanguagePicker } from "./document-language-picker";

type JobSelectionToolbarProps = {
  all: boolean;
  count: number;
  onLanguageChange: (choice: DocumentLanguageChoice) => void;
  onRemove: () => void;
  onToggleAll: (selected: boolean) => void;
};

// The picker shows "auto" rather than the selection's current language on purpose: with
// more than one row selected there may be several, and picking one to display would
// claim the others agree with it.
const JobSelectionToolbar = ({
  all,
  count,
  onLanguageChange,
  onRemove,
  onToggleAll,
}: JobSelectionToolbarProps) => {
  const { t } = useTranslations();

  const handleToggleAll = () => {
    onToggleAll(!all);
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="flex h-lh items-center text-base sm:text-sm">
        <Checkbox
          aria-label={t("files.selectAll")}
          checked={all}
          indeterminate={!all}
          onChange={handleToggleAll}
        />
      </span>

      <p className="text-base font-medium tabular-nums sm:text-sm">
        {t("files.selected", { count })}
      </p>

      <div className="ml-auto flex items-center gap-2">
        <DocumentLanguagePicker onChange={onLanguageChange} value="auto" />

        <Button onClick={onRemove} size="sm" variant="destructive">
          {t("files.removeSelected")}
        </Button>
      </div>
    </div>
  );
};

export { JobSelectionToolbar };
export type { JobSelectionToolbarProps };
