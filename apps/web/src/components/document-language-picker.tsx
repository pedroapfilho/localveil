import { LOCALE_NAMES, useTranslations } from "@repo/i18n";
import type { DocumentLanguage } from "@repo/redact-core";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";

// "auto" keeps today's behaviour: probe in English, then guess from stopwords. The
// explicit choices exist because that guess has almost nothing to read on an
// identity card, and the reader holding one knows the answer already.
type DocumentLanguageChoice = "auto" | DocumentLanguage;

type Props = {
  onChange: (value: DocumentLanguageChoice) => void;
  value: DocumentLanguageChoice;
};

const CHOICES: ReadonlyArray<DocumentLanguageChoice> = ["auto", "en", "pt", "es"];

const isChoice = (value: unknown): value is DocumentLanguageChoice =>
  typeof value === "string" && CHOICES.some((choice) => choice === value);

const DocumentLanguagePicker = ({ onChange, value }: Props) => {
  const { t } = useTranslations();

  const nameOf = (choice: unknown) => {
    if (!isChoice(choice)) {
      return "";
    }

    return choice === "auto" ? t("dropzone.languageAuto") : LOCALE_NAMES[choice];
  };

  const handleChange = (next: unknown) => {
    if (isChoice(next)) {
      onChange(next);
    }
  };

  return (
    <div className="flex items-center justify-center gap-2">
      <span className="text-muted-foreground text-base sm:text-sm">{t("dropzone.language")}</span>

      <Select onValueChange={handleChange} value={value}>
        <SelectTrigger aria-label={t("dropzone.language")} className="border-transparent">
          <SelectValue>{(current: unknown) => nameOf(current)}</SelectValue>
        </SelectTrigger>

        <SelectContent>
          <SelectGroup>
            {CHOICES.map((choice) => (
              <SelectItem key={choice} value={choice}>
                {nameOf(choice)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
};

export { DocumentLanguagePicker };
export type { DocumentLanguageChoice };
