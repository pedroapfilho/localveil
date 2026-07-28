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

  if (!downloading && !slowDevice) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      {downloading ? (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-muted-foreground text-base text-pretty sm:text-sm">
              {t("model.downloading")}
            </p>

            <p className="text-muted-foreground shrink-0 text-base tabular-nums sm:text-sm">
              {percentFormat.format(fraction)}
            </p>
          </div>

          <Progress className="h-0.5" label={t("model.downloading")} value={fraction} />
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
