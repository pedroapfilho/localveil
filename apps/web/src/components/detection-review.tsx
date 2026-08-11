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
  onApply: () => void;
  onDismissedChange: (dismissed: ReadonlyArray<string>) => void;
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
  onApply,
  onDismissedChange,
}: DetectionReviewProps) => {
  const { t } = useTranslations();
  const groups = useMemo(() => groupByLabel(detections), [detections]);
  const dropped = useMemo(() => new Set(dismissed), [dismissed]);

  if (detections.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">{t("review.nothing")}</p>
        <Button className="self-start" onClick={onApply} size="sm">
          {t("review.apply")}
        </Button>
      </div>
    );
  }

  const kept = detections.length - dropped.size;

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
        {t("review.heading", { count: String(detections.length) })}
      </p>

      <ScrollArea className="max-h-80">
        <div className="flex flex-col [&>*]:[contain-intrinsic-size:auto_28px] [&>*]:[content-visibility:auto]">
          {rows.map(renderRow)}
        </div>
      </ScrollArea>

      <p aria-live="polite" className="text-muted-foreground text-xs tabular-nums">
        {t("review.kept", { count: String(kept), total: String(detections.length) })}
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
