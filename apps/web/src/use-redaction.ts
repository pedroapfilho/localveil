import type { I18nValue } from "@repo/i18n";
import { useTranslations } from "@repo/i18n";
import type { ModelId } from "@repo/pii-detect/models";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";

import type { CreatePool, JobNotice, JobRunner } from "./job-runner";
import { createJobRunner } from "./job-runner";
import type { JobInput } from "./store";

const MODEL_TOAST = "model-load";

type Translate = I18nValue["t"];

const show = (notice: JobNotice, t: Translate) => {
  switch (notice.kind) {
    case "file-failed": {
      toast.error(t("toast.failed", { name: notice.name }));
      break;
    }

    case "file-unsupported": {
      toast.error(t("toast.unsupported", { name: notice.name }));
      break;
    }

    case "model-downloading": {
      toast.loading(t("model.downloading"), { id: MODEL_TOAST });
      break;
    }

    case "model-dropped": {
      toast.dismiss(MODEL_TOAST);
      break;
    }

    case "model-failed": {
      toast.error(t("model.failed"), { id: MODEL_TOAST });
      break;
    }

    case "model-lost": {
      toast.error(t(notice.failure));
      break;
    }

    case "model-ready": {
      toast.success(t("model.ready"), { id: MODEL_TOAST });
      break;
    }

    case "slow-device": {
      toast.warning(t("model.slowDevice"));
      break;
    }

    default: {
      notice satisfies never;
    }
  }
};

const useRedaction = (createPool: CreatePool) => {
  const { t } = useTranslations();
  const translateRef = useRef(t);
  const runnerRef = useRef<JobRunner | null>(null);

  useEffect(() => {
    translateRef.current = t;
  }, [t]);

  useEffect(() => {
    const runner = createJobRunner({
      createPool,
      onNotice: (notice) => {
        show(notice, translateRef.current);
      },
    });

    runnerRef.current = runner;

    return () => {
      runner.destroy();
      runnerRef.current = null;
    };
  }, [createPool]);

  return useMemo(
    () => ({
      apply: (id: string, covered: ReadonlyArray<string>) => {
        runnerRef.current?.apply(id, covered);
      },
      clear: () => {
        runnerRef.current?.clear();
      },
      remove: (ids: ReadonlyArray<string>) => {
        runnerRef.current?.remove(ids);
      },
      selectModel: (model: ModelId) => {
        runnerRef.current?.selectModel(model);
      },
      submit: (files: Array<JobInput>) => {
        runnerRef.current?.submit(files);
      },
    }),
    [],
  );
};

export { useRedaction };
