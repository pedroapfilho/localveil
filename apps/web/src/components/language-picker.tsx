import { isLocale, LOCALE_NAMES, LOCALES, useTranslations } from "@repo/i18n";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";

const LanguagePicker = () => {
  const { locale, setLocale, t } = useTranslations();

  const handleChange = (value: string) => {
    if (isLocale(value)) {
      setLocale(value);
    }
  };

  return (
    <Select
      onValueChange={(value) => {
        if (typeof value === "string") {
          handleChange(value);
        }
      }}
      value={locale}
    >
      <SelectTrigger aria-label={t("app.language")} className="border-transparent">
        <SelectValue>
          {(value) => (typeof value === "string" && isLocale(value) ? LOCALE_NAMES[value] : "")}
        </SelectValue>
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
