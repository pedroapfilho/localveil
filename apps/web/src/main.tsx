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
    {/* Motion sets inline styles, so the blanket reduced-motion rule in the stylesheet
        never reaches it. "user" drops the movement and keeps the fade, which is what
        somebody who asked for less motion wants: not nothing, just nothing that
        travels. */}
    <MotionConfig reducedMotion="user">
      <I18nProvider>
        <App />

        <Toaster />
      </I18nProvider>
    </MotionConfig>
  </StrictMode>,
);
