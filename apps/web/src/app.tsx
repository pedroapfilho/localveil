import { useTranslations } from "@repo/i18n";
import { FileDropzone } from "@repo/ui/components/file-dropzone";
import { toast } from "@repo/ui/components/sonner";

import { DownloadPanel } from "./components/download-panel";
import { JobList } from "./components/job-list";
import { ModelStatus } from "./components/model-status";
import { useJobStore } from "./store";
import { useDocumentLocale } from "./use-document-locale";
import { useRedaction } from "./use-redaction";

const ACCEPTED_FILES = ".txt,.md,.csv,.json,.log,.pdf,text/*,application/pdf,image/*";

const App = () => {
  const { t } = useTranslations();
  const jobs = useJobStore((state) => state.jobs);
  const removeJob = useJobStore((state) => state.removeJob);
  const { downloadZip, model, submit } = useRedaction();

  useDocumentLocale();

  const runDownload = async () => {
    try {
      await downloadZip();
      toast.success(t("toast.downloaded"));
    } catch {
      toast.error(t("error.unknown"));
    }
  };

  const handleDownload = () => {
    void runDownload();
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
        <ModelStatus model={model} />

        <div className="flex flex-col items-center gap-2">
          <FileDropzone
            accept={ACCEPTED_FILES}
            hint={t("dropzone.hint")}
            label={t("dropzone.label")}
            onFilesSelected={submit}
          />

          <p className="text-muted-foreground text-xs">{t("dropzone.formats")}</p>
        </div>

        <JobList jobs={jobs} onRemove={removeJob} />

        <DownloadPanel jobs={jobs} onDownload={handleDownload} />
      </main>
    </div>
  );
};

export { App };
