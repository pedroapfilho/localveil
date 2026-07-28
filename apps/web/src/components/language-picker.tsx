import { isLocale, LOCALE_NAMES, LOCALES, useTranslations } from "@repo/i18n";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";

const nameOf = (value: unknown) =>
  typeof value === "string" && isLocale(value) ? LOCALE_NAMES[value] : "";

// Each language names itself. A reader looking for Portuguese is looking for the word
// "Português", not for whatever the interface currently calls it.
const LanguagePicker = () => {
  const { locale, setLocale, t } = useTranslations();

  const handleChange = (value: unknown) => {
    if (typeof value === "string" && isLocale(value)) {
      setLocale(value);
    }
  };

  return (
    <Select onValueChange={handleChange} value={locale}>
      <SelectTrigger aria-label={t("app.language")} className="border-transparent">
        {/* The trigger shows a language name, not the "pt" underneath it, and only
            this component knows the mapping. */}
        <SelectValue>{(value: unknown) => nameOf(value)}</SelectValue>
      </SelectTrigger>

      <SelectContent>
        <SelectGroup>
          {LOCALES.map((option) => (
            <SelectItem key={option} value={option}>
              {LOCALE_NAMES[option]}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
};

export { LanguagePicker };
