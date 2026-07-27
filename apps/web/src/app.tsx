import { useTranslations } from "@repo/i18n";
import { FileDropzone } from "@repo/ui/components/file-dropzone";
import { useState } from "react";

import { useDocumentLocale } from "./use-document-locale";

const App = () => {
  const { t } = useTranslations();
  const [names, setNames] = useState<Array<string>>([]);

  useDocumentLocale();

  const handleFilesSelected = (files: Array<File>) => {
    setNames((current) => [...current, ...files.map((file) => file.name)]);
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-8 px-4 py-12">
      <a className="sr-only focus:not-sr-only" href="#main">
        {t("app.skipToContent")}
      </a>

      <header className="flex flex-col gap-2 text-center">
        <h1 className="text-3xl font-semibold">{t("app.name")}</h1>

        <p className="text-muted-foreground">{t("app.tagline")}</p>
      </header>

      <main className="flex flex-col gap-8" id="main">
        <FileDropzone
          hint={t("dropzone.hint")}
          label={t("dropzone.label")}
          onFilesSelected={handleFilesSelected}
        />

        <section className="flex flex-col gap-2">
          <h2 className="font-medium">{t("files.heading")}</h2>

          {names.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("files.empty")}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {names.map((name, index) => (
                <li key={`${name}-${String(index)}`}>{name}</li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
};

export { App };
