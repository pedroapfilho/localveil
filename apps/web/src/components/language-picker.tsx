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
