import { useTranslations } from "@repo/i18n";
import type { ModelId } from "@repo/pii-detect/models";
import { modelById, MODELS } from "@repo/pii-detect/models";
import { toast } from "sonner";

import type { ModelPickerProps } from "./components/model-picker";
import { useModelLibrary } from "./model-library";
import { useJobStore } from "./store";

const isInFlight = (status: string) => status === "queued" || status === "running";

/* Files already in review keep the analysis their model gave them; only work still reaching the
   model would be split across two of them, so that is what holds a switch back. */
const useModelPicker = (): ModelPickerProps => {
  const { t } = useTranslations();
  const entries = useModelLibrary((state) => state.entries);
  const selected = useModelLibrary((state) => state.selected);
  const busy = useJobStore((state) => state.jobs.some((job) => isInFlight(job.status)));

  const runDownload = async (id: ModelId) => {
    const { name } = modelById(id);

    try {
      await useModelLibrary.getState().download(id);
      toast.success(t("models.downloaded", { name }));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        toast.info(t("models.downloadStopped", { name }));

        return;
      }

      toast.error(t("models.downloadFailed", { name }));
    }
  };

  const runRemove = async (id: ModelId) => {
    const { name } = modelById(id);

    try {
      await useModelLibrary.getState().remove(id);
      toast.success(t("models.removed", { name }));
    } catch {
      toast.error(t("models.removeFailed", { name }));
    }
  };

  return {
    busy,
    entries,
    models: MODELS,
    onDownload: (id) => {
      void runDownload(id);
    },
    onOpen: () => {
      void useModelLibrary.getState().refresh();
    },
    onRemove: (id) => {
      void runRemove(id);
    },
    onSelect: (id) => {
      if (!busy) {
        useModelLibrary.getState().select(id);
      }
    },
    onStop: (id) => {
      useModelLibrary.getState().cancel(id);
    },
    selected,
  };
};

export { useModelPicker };
