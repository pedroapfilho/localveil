import { useTranslations } from "@repo/i18n";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@repo/ui/components/popover";
import { useMemo } from "react";

const TERMS = ["ocr", "searchable"] as const;

type GlossaryTermName = (typeof TERMS)[number];

const SPECIAL = /[$*+.?^\\\(\)\[\]\{\|\}]/gv;

const quote = (value: string) => value.replaceAll(SPECIAL, String.raw`\$&`);

type GlossaryTermProps = {
  label: string;
  name: GlossaryTermName;
};

const GlossaryTerm = ({ label, name }: GlossaryTermProps) => {
  const { t } = useTranslations();

  return (
    <Popover>
      <PopoverTrigger
        className="cursor-help underline decoration-current/40 decoration-dotted decoration-from-font underline-offset-4 hover:decoration-current data-popup-open:decoration-current"
        openOnHover
      >
        {label}
      </PopoverTrigger>

      <PopoverContent className="flex flex-col gap-1">
        <PopoverTitle>{label}</PopoverTitle>

        <PopoverDescription>{t(`glossary.${name}.description`)}</PopoverDescription>
      </PopoverContent>
    </Popover>
  );
};

const GlossaryText = ({ children }: { children: string }) => {
  const { t } = useTranslations();

  const named = useMemo(
    () => new Map(TERMS.map((name) => [t(`glossary.${name}.label`), name])),
    [t],
  );

  const pattern = useMemo(
    () => new RegExp(`(${[...named.keys()].map(quote).join("|")})`, "gv"),
    [named],
  );

  return (
    <span>
      {children.split(pattern).map((part, index) => {
        const name = named.get(part);

        return name === undefined ? (
          part
        ) : (
          <GlossaryTerm key={`${part}-${String(index)}`} label={part} name={name} />
        );
      })}
    </span>
  );
};

export { GlossaryText };
