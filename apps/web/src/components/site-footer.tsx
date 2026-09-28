import { useTranslations } from "@repo/i18n";
import { modelById } from "@repo/pii-detect/models";
import { ArrowUpRightIcon } from "lucide-react";

import { useModelLibrary } from "../model-library";

const SiteFooter = () => {
  const { t } = useTranslations();
  const selected = useModelLibrary((state) => state.selected);

  const links = [
    { href: "https://github.com/pedroapfilho/localveil", key: "footer.github" },
    { href: modelById(selected).card, key: "footer.model" },
  ] as const;

  return (
    <footer className="border-foreground/10 border-t">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-10 sm:py-12">
        <h2 className="text-base font-medium sm:text-sm">{t("footer.heading")}</h2>

        <p className="text-muted-foreground max-w-(--container-measure-footer) text-base text-pretty sm:text-sm">
          {t("footer.summary")}
        </p>

        <p className="text-muted-foreground max-w-(--container-measure-footer) text-base text-pretty sm:text-sm">
          {t("footer.offline")}
        </p>

        {/* oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Safari drops list semantics from an unstyled list */}
        <ul className="flex flex-wrap gap-x-6 gap-y-2" role="list">
          {links.map((link) => (
            <li className="text-base font-normal sm:text-sm" key={link.key}>
              <a
                className="text-foreground focus-visible:outline-ring inline-flex items-center gap-1 underline decoration-current/30 underline-offset-4 hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2"
                href={link.href}
                rel="noreferrer noopener"
                target="_blank"
              >
                {t(link.key)}

                <ArrowUpRightIcon aria-hidden className="size-4 h-lh shrink-0" />
              </a>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  );
};

export { SiteFooter };
