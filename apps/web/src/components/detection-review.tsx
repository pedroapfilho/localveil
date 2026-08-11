import type { MessageKey } from "@repo/i18n";
import { useTranslations } from "@repo/i18n";
import type { Detection, PiiLabel } from "@repo/redact-core";
import { Button } from "@repo/ui/components/button";
import { Checkbox } from "@repo/ui/components/checkbox";
import { ScrollArea } from "@repo/ui/components/scroll-area";
import { useMemo } from "react";

const LABEL_KEYS: Record<PiiLabel, MessageKey> = {
  account_number: "label.account_number",
  private_address: "label.private_address",
  private_date: "label.private_date",
  private_email: "label.private_email",
  private_person: "label.private_person",
  private_phone: "label.private_phone",
  private_url: "label.private_url",
  secret: "label.secret",
};

type DetectionReviewProps = {
  detections: Array<Detection>;
  dismissed: ReadonlyArray<string>;
  kept: ReadonlyArray<string>;
  onApply: () => void;
  onDismissedChange: (dismissed: ReadonlyArray<string>) => void;
  onKeptChange: (kept: ReadonlyArray<string>) => void;
};

type Group = { detections: Array<Detection>; label: PiiLabel };

type Row = { group: Group; kind: "header" } | { detection: Detection; kind: "row" };

const groupByLabel = (detections: Array<Detection>): Array<Group> => {
  const groups = new Map<PiiLabel, Array<Detection>>();

  for (const detection of detections) {
    const existing = groups.get(detection.label);

    if (existing === undefined) {
      groups.set(detection.label, [detection]);
    } else {
      existing.push(detection);
    }
  }

  return [...groups.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([label, found]) => ({
      detections: found.toSorted((left, right) => left.confidence - right.confidence),
      label,
    }));
};

const DetectionReview = ({
  detections,
  dismissed,
  kept,
  onApply,
  onDismissedChange,
  onKeptChange,
}: DetectionReviewProps) => {
  const { t } = useTranslations();
  const certain = useMemo(() => detections.filter((entry) => !entry.suggested), [detections]);
  const maybe = useMemo(() => detections.filter((entry) => entry.suggested), [detections]);
  const groups = useMemo(() => groupByLabel(certain), [certain]);
  const dropped = useMemo(() => new Set(dismissed), [dismissed]);
  const chosen = useMemo(() => new Set(kept), [kept]);

  if (certain.length === 0 && maybe.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">{t("review.nothing")}</p>
        <Button className="self-start" onClick={onApply} size="sm">
          {t("review.apply")}
        </Button>
      </div>
    );
  }

  const covering = certain.length - dropped.size + chosen.size;

  const toggle = (id: string) => {
    onDismissedChange(
      dropped.has(id) ? dismissed.filter((other) => other !== id) : [...dismissed, id],
    );
  };

  const dismissGroup = (group: Group) => {
    const ids = group.detections.map((detection) => detection.id);
    const everyDropped = ids.every((id) => dropped.has(id));

    onDismissedChange(
      everyDropped
        ? dismissed.filter((id) => !ids.includes(id))
        : [...new Set([...dismissed, ...ids])],
    );
  };

  const toggleSuggestion = (id: string) => {
    onKeptChange(chosen.has(id) ? kept.filter((other) => other !== id) : [...kept, id]);
  };

  const rows: Array<Row> = [];

  for (const group of groups) {
    rows.push({ group, kind: "header" });

    for (const detection of group.detections) {
      rows.push({ detection, kind: "row" });
    }
  }

  const renderRow = (row: Row) => {
    if (row.kind === "header") {
      return (
        <div
          className="bg-background/95 flex items-center justify-between gap-2 py-1"
          key={`header-${row.group.label}`}
        >
          <span className="text-xs font-medium">{t(LABEL_KEYS[row.group.label])}</span>
          <Button
            onClick={() => {
              dismissGroup(row.group);
            }}
            size="sm"
            variant="ghost"
          >
            {t("review.dismissGroup", { label: t(LABEL_KEYS[row.group.label]) })}
          </Button>
        </div>
      );
    }

    const { detection } = row;

    return (
      <label
        className="hover:bg-muted/60 flex min-h-6 cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-sm"
        key={detection.id}
      >
        <Checkbox
          aria-label={t("review.toggle", { preview: detection.preview })}
          checked={!dropped.has(detection.id)}
          onChange={() => {
            toggle(detection.id);
          }}
        />
        <span className="truncate font-mono text-xs">{detection.preview}</span>
        <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
          {detection.page === undefined
            ? null
            : `${t("review.page", { number: String(detection.page + 1) })} · `}
          {(detection.confidence * 100).toFixed(0)}%
        </span>
      </label>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        {t("review.heading", { count: String(certain.length) })}
      </p>

      <ScrollArea className="max-h-80">
        <div className="flex flex-col [&>*]:[contain-intrinsic-size:auto_28px] [&>*]:[content-visibility:auto]">
          {rows.map(renderRow)}
        </div>
      </ScrollArea>

      {maybe.length === 0 ? null : (
        <details className="border-foreground/10 rounded-md border p-2">
          <summary className="cursor-pointer text-xs font-medium">
            {t("review.suggestions", { count: String(maybe.length) })}
          </summary>

          <p className="text-muted-foreground pt-1 pb-2 text-xs">{t("review.suggestionsHint")}</p>

          <div className="flex flex-col">
            {maybe.map((detection) => (
              <label
                className="hover:bg-muted/60 flex min-h-6 cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-sm"
                key={detection.id}
              >
                <Checkbox
                  aria-label={t("review.toggle", { preview: detection.preview })}
                  checked={chosen.has(detection.id)}
                  onChange={() => {
                    toggleSuggestion(detection.id);
                  }}
                />
                <span className="truncate font-mono text-xs">{detection.preview}</span>
                <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
                  {t(LABEL_KEYS[detection.label])} · {(detection.confidence * 100).toFixed(0)}%
                </span>
              </label>
            ))}
          </div>
        </details>
      )}

      <p aria-live="polite" className="text-muted-foreground text-xs tabular-nums">
        {t("review.kept", { count: String(covering), total: String(detections.length) })}
      </p>

      <div className="flex gap-2">
        <Button onClick={onApply} size="sm">
          {t("review.apply")}
        </Button>
        <Button
          onClick={() => {
            onDismissedChange([]);
            onApply();
          }}
          size="sm"
          variant="outline"
        >
          {t("review.keepAll")}
        </Button>
      </div>
    </div>
  );
};

export { DetectionReview, groupByLabel };
