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

type ModelNotice = Exclude<JobNotice["kind"], "file-failed" | "file-unsupported" | "model-lost">;

const MODEL_TOASTS = {
  "model-downloading": (t) => {
    toast.loading(t("model.downloading"), { id: MODEL_TOAST });
  },
  "model-dropped": () => {
    toast.dismiss(MODEL_TOAST);
  },
  "model-failed": (t) => {
    toast.error(t("model.failed"), { id: MODEL_TOAST });
  },
  "model-ready": (t) => {
    toast.success(t("model.ready"), { id: MODEL_TOAST });
  },
  "slow-device": (t) => {
    toast.warning(t("model.slowDevice"));
  },
} satisfies Record<ModelNotice, (t: Translate) => void>;

const show = (notice: JobNotice, t: Translate) => {
  if (notice.kind === "file-failed" || notice.kind === "file-unsupported") {
    const message = notice.kind === "file-failed" ? "toast.failed" : "toast.unsupported";

    toast.error(t(message, { name: notice.name }));
  } else if (notice.kind === "model-lost") {
    toast.error(notice.reason);
  } else {
    MODEL_TOASTS[notice.kind](t);
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
      remove: (id: string) => {
        runnerRef.current?.remove([id]);
      },
      removeMany: (ids: ReadonlyArray<string>) => {
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
