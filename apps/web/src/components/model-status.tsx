import { useTranslations } from "@repo/i18n";
import { Progress } from "@repo/ui/components/progress";
import { useMemo } from "react";

import type { ModelState } from "../use-redaction";

type ModelStatusProps = {
  model: ModelState;
};

const ModelStatus = ({ model }: ModelStatusProps) => {
  const { locale, t } = useTranslations();
  const { fraction, slowDevice, stage } = model;

  const percentFormat = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 0, style: "percent" }),
    [locale],
  );

  const downloading = stage === "model.downloading";

  // Once the model is loaded there is nothing here worth a line of the page: the
  // file rows carry every stage from then on. A reader whose model was already on
  // disk should see none of this at all.
  if (!downloading && !slowDevice) {
    return null;
  }

  const downloadMessage = t("model.downloading", { percent: percentFormat.format(fraction) });

  return (
    <div className="ring-foreground/10 flex flex-col gap-3 rounded-xl px-4 py-4 ring-1 sm:px-5">
      {downloading ? (
        <>
          <p className="text-base text-pretty tabular-nums sm:text-sm">{downloadMessage}</p>

          <Progress label={downloadMessage} value={fraction} />
        </>
      ) : null}

      {slowDevice ? (
        <p className="text-muted-foreground text-base text-pretty sm:text-sm">
          {t("model.slowDevice")}
        </p>
      ) : null}
    </div>
  );
};

export { ModelStatus };
export type { ModelStatusProps };
