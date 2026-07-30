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
  className?: string;
  onChange: (value: DocumentLanguageChoice) => void;
  value: DocumentLanguageChoice;
};

const CHOICES: ReadonlyArray<DocumentLanguageChoice> = ["auto", "en", "pt", "es"];

const isChoice = (value: unknown): value is DocumentLanguageChoice =>
  typeof value === "string" && CHOICES.some((choice) => choice === value);

const asChoice = (language?: DocumentLanguage): DocumentLanguageChoice => language ?? "auto";

const asLanguage = (choice: DocumentLanguageChoice) => (choice === "auto" ? undefined : choice);

// Labelled rather than captioned: this now sits in a file row and in a selection
// toolbar, where a visible "Document language" beside every one of them would say the
// same thing as many times as there are files.
const DocumentLanguagePicker = ({ className, onChange, value }: Props) => {
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
    <Select onValueChange={handleChange} value={value}>
      <SelectTrigger aria-label={t("dropzone.language")} className={className}>
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
  );
};

export { asChoice, asLanguage, DocumentLanguagePicker };
export type { DocumentLanguageChoice };
