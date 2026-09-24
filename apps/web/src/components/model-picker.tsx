import type { MessageKey } from "@repo/i18n";
import { useTranslations } from "@repo/i18n";
import type { ModelId, ModelSpec } from "@repo/pii-detect/models";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@repo/ui/components/attachment";
import { Button } from "@repo/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@repo/ui/components/popover";
import { FractionProgress } from "@repo/ui/compositions/fraction-progress";
import {
  CircleCheckIcon,
  CircleIcon,
  CpuIcon,
  DownloadIcon,
  LoaderCircleIcon,
  Trash2Icon,
} from "lucide-react";

import type { ModelEntry } from "../model-library";

type PickerModel = ModelSpec & { id: ModelId };

const SUMMARY_KEYS = {
  "gliner-multi-pii": "models.summary.gliner-multi-pii",
  "gliner-pii-base": "models.summary.gliner-pii-base",
} as const satisfies Record<ModelId, MessageKey>;

const MEGABYTE = 1_000_000;

const formatSize = (bytes: number, locale: string) =>
  new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
    style: "unit",
    unit: "megabyte",
  }).format(bytes / MEGABYTE);

// A partial download never reads as done: the last chunk is what moves it into the cache.
const percentOf = (loaded: number, total: number) =>
  total > 0 ? Math.min(99, Math.floor((loaded / total) * 100)) : 0;

type ModelRowProps = {
  busy: boolean;
  entry: ModelEntry | undefined;
  model: PickerModel;
  onDownload: (id: ModelId) => void;
  onRemove: (id: ModelId) => void;
  onSelect: (id: ModelId) => void;
  selected: boolean;
};

const ModelRow = ({
  busy,
  entry,
  model,
  onDownload,
  onRemove,
  onSelect,
  selected,
}: ModelRowProps) => {
  const { locale, t } = useTranslations();
  const { id, name } = model;
  const status = entry?.status;
  const downloading = entry?.progress !== undefined;
  const working = downloading || entry?.removing === true;
  const kept = status?.state === "ready" || status?.state === "partial";
  const size = formatSize(model.bytes, locale);

  const describe = () => {
    if (entry?.progress !== undefined) {
      return t("models.status.downloading", {
        percent: Math.floor(entry.progress * 100),
        size,
      });
    }

    if (status?.state === "ready") {
      return t("models.status.ready", { size: formatSize(status.bytes, locale) });
    }

    if (status?.state === "partial") {
      return t("models.status.partial", {
        percent: percentOf(status.loaded, status.total),
        size,
      });
    }

    return t("models.status.absent", { size });
  };

  const state = () => {
    if (downloading) {
      return "processing";
    }

    return status?.state === "ready" ? "done" : "idle";
  };

  return (
    <li>
      <Attachment className="w-full" orientation="horizontal" state={state()}>
        <AttachmentTrigger
          aria-label={t("models.use", { name })}
          aria-pressed={selected}
          disabled={busy && !selected}
          onClick={() => {
            onSelect(id);
          }}
        />

        <AttachmentMedia>
          {selected ? (
            <CircleCheckIcon aria-hidden className="text-primary size-4 shrink-0" />
          ) : (
            <CircleIcon aria-hidden className="text-muted-foreground size-4 shrink-0" />
          )}
        </AttachmentMedia>

        <AttachmentContent>
          <span className="flex items-baseline gap-2">
            <AttachmentTitle title={name}>{name}</AttachmentTitle>

            {selected ? (
              <span className="text-primary shrink-0 text-xs font-medium">{t("models.inUse")}</span>
            ) : null}
          </span>

          <span className="text-muted-foreground mt-0.5 block text-xs text-pretty">
            {t(SUMMARY_KEYS[id])}
          </span>

          <span className="text-muted-foreground mt-1 block text-xs tabular-nums">
            {describe()}
          </span>

          {downloading ? (
            <FractionProgress className="mt-1.5" label={name} value={entry.progress ?? 0} />
          ) : null}
        </AttachmentContent>

        <AttachmentActions>
          {status?.state !== "ready" && !working ? (
            <AttachmentAction
              aria-label={t("models.download", { name })}
              onClick={() => {
                onDownload(id);
              }}
            >
              <DownloadIcon aria-hidden />
            </AttachmentAction>
          ) : null}

          {kept && !working ? (
            <AttachmentAction
              aria-label={t("models.remove", { name })}
              onClick={() => {
                onRemove(id);
              }}
            >
              <Trash2Icon aria-hidden />
            </AttachmentAction>
          ) : null}
        </AttachmentActions>
      </Attachment>
    </li>
  );
};

type ModelPickerProps = {
  busy: boolean;
  entries: Partial<Record<ModelId, ModelEntry>>;
  models: ReadonlyArray<PickerModel>;
  onDownload: (id: ModelId) => void;
  onOpen: () => void;
  onRemove: (id: ModelId) => void;
  onSelect: (id: ModelId) => void;
  selected: ModelId;
};

const ModelPicker = ({
  busy,
  entries,
  models,
  onDownload,
  onOpen,
  onRemove,
  onSelect,
  selected,
}: ModelPickerProps) => {
  const { t } = useTranslations();
  const current = models.find((model) => model.id === selected);
  const name = current?.name ?? "";
  const downloading = models.some((model) => entries[model.id]?.progress !== undefined);

  return (
    <Popover
      onOpenChange={(open) => {
        if (open) {
          onOpen();
        }
      }}
    >
      <PopoverTrigger
        aria-label={t("models.trigger", { name })}
        render={<Button variant="outline" />}
      >
        {downloading ? (
          <LoaderCircleIcon aria-hidden className="motion-safe:animate-spin" />
        ) : (
          <CpuIcon aria-hidden />
        )}

        {name}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 gap-3 sm:w-96">
        <PopoverHeader>
          <PopoverTitle>{t("models.heading")}</PopoverTitle>

          <PopoverDescription>{t("models.description")}</PopoverDescription>
        </PopoverHeader>

        {busy ? (
          <p className="text-muted-foreground text-xs text-pretty">{t("models.busy")}</p>
        ) : null}

        {/* oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Safari drops list semantics from an unstyled list */}
        <ul className="flex flex-col gap-2" role="list">
          {models.map((model) => (
            <ModelRow
              busy={busy}
              entry={entries[model.id]}
              key={model.id}
              model={model}
              onDownload={onDownload}
              onRemove={onRemove}
              onSelect={onSelect}
              selected={model.id === selected}
            />
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
};

export { ModelPicker };
export type { ModelPickerProps, PickerModel };
