import "@repo/ui/globals.css";

import { I18nProvider } from "@repo/i18n";
import { Toaster } from "@repo/ui/components/sonner";
import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";

const container = document.querySelector("#root");

if (container === null) {
  throw new Error("index.html is missing its #root element");
}

createRoot(container).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <I18nProvider>
        <App />

        <Toaster />
      </I18nProvider>
    </MotionConfig>
  </StrictMode>,
);
