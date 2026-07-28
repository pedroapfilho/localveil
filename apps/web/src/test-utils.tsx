// The shared setup file loads these matchers at run time, but it lives in another
// package, so this is what puts their types in front of `tsc` here.
import "@testing-library/jest-dom/vitest";

import { I18nProvider } from "@repo/i18n";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

const renderWithI18n = (ui: ReactElement) => render(ui, { wrapper: I18nProvider });

export { renderWithI18n };
