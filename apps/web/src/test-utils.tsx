import "@testing-library/jest-dom/vitest";

import { I18nProvider } from "@repo/i18n";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import type { Job, JobSource, JobState } from "./store";

const renderWithI18n = (ui: ReactElement) => render(ui, { wrapper: I18nProvider });

const NOTES = new File(["hello"], "notes.txt", { type: "text/plain" });

const QUEUED: JobState = { phase: "queued" };

const jobOf = (state: JobState = QUEUED, source: Partial<JobSource> = {}): Job => ({
  file: NOTES,
  id: "job-1",
  path: (source.file ?? NOTES).name,
  ...source,
  ...state,
});

export { jobOf, renderWithI18n };
