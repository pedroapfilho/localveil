import "@testing-library/jest-dom/vitest";

import { I18nProvider } from "@repo/i18n";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

const renderWithI18n = (ui: ReactElement) => render(ui, { wrapper: I18nProvider });

export { renderWithI18n };
