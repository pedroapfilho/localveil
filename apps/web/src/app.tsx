import { useTranslations } from "@repo/i18n";
import { FileDropzone } from "@repo/ui/components/file-dropzone";
import { toast } from "@repo/ui/components/sonner";
import { AnimatePresence, motion } from "motion/react";

import { DownloadPanel } from "./components/download-panel";
import { JobList } from "./components/job-list";
import { LanguagePicker } from "./components/language-picker";
import { ModelStatus } from "./components/model-status";
import { SiteFooter } from "./components/site-footer";
import { useJobStore } from "./store";
import { useDocumentLocale } from "./use-document-locale";
import { useRedaction } from "./use-redaction";

const ACCEPTED_FILES = ".txt,.md,.csv,.json,.log,.pdf,text/*,application/pdf,image/*";

// The strong ease-out from the house animation standards, and short enough that the
// page reads as arranging itself rather than performing.
const APPEAR = { duration: 0.2, ease: [0.23, 1, 0.32, 1] } as const;

const SLIDE = {
  animate: { opacity: 1, transform: "translateY(0px)" },
  exit: { opacity: 0, transform: "translateY(-6px)" },
  initial: { opacity: 0, transform: "translateY(-6px)" },
};

// The same shapes as favicon.svg, inline rather than fetched: it is three rectangles,
// and an image request for them would cost a round trip and a frame of empty box. The
// h1 beside it carries the name, so there is nothing here to announce.
const BrandMark = () => (
  <svg aria-hidden className="size-12 shrink-0" viewBox="0 0 32 32">
    <rect className="fill-primary" height="32" rx="7" width="32" />

    <rect className="fill-primary-foreground" height="5" rx="2.5" width="18" x="7" y="9" />

    <rect
      className="fill-primary-foreground"
      height="5"
      opacity="0.55"
      rx="2.5"
      width="11"
      x="7"
      y="18"
    />
  </svg>
);

const App = () => {
  const { t } = useTranslations();
  const jobs = useJobStore((state) => state.jobs);
  const { downloadZip, model, remove, submit } = useRedaction();

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

  const queued = jobs.length > 0;

  return (
    <div className="isolate grid min-h-dvh grid-rows-[1fr_auto]">
      <a
        className="focus:bg-background focus:ring-ring sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:rounded-lg focus:px-3 focus:py-2 focus:ring-2"
        href="#main"
      >
        {t("app.skipToContent")}
      </a>

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-6 pt-4 pb-16 sm:gap-12 sm:pb-20">
        <div className="flex justify-end">
          <LanguagePicker />
        </div>

        <header className="flex flex-col items-center gap-5 text-center">
          <BrandMark />

          <div className="flex flex-col gap-3">
            <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              {t("app.name")}
            </h1>

            <p className="text-muted-foreground mx-auto max-w-[48ch] text-base text-pretty sm:text-lg">
              {t("app.tagline")}
            </p>
          </div>
        </header>

        <main className="flex flex-col gap-8" id="main">
          <ModelStatus model={model} />

          <FileDropzone
            accept={ACCEPTED_FILES}
            formats={t("dropzone.formats")}
            hint={t("dropzone.hint")}
            label={t("dropzone.label")}
            onFilesSelected={submit}
          />

          {/* Both arrive with the first file and leave with the last, so they slide in
              rather than appearing under the reader's cursor. */}
          <AnimatePresence initial={false}>
            {queued ? (
              <motion.div
                className="flex flex-col gap-8"
                key="queue"
                transition={APPEAR}
                {...SLIDE}
              >
                <JobList jobs={jobs} onRemove={remove} />

                <DownloadPanel jobs={jobs} onDownload={handleDownload} />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </main>
      </div>

      <SiteFooter />
    </div>
  );
};

export { App };
