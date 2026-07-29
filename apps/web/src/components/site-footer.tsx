// Safari drops list semantics from a `ul` whose bullets are removed, and these have
// none, so `role="list"` restores what the styling took away rather than repeating
// what the element already says.
/* oxlint-disable jsx-a11y/no-redundant-roles */
import { useTranslations } from "@repo/i18n";
import { ArrowUpRightIcon } from "lucide-react";

const LINKS = [
  { href: "https://github.com/pedroapfilho/localveil", key: "footer.github" },
  { href: "https://huggingface.co/urchade/gliner_multi_pii-v1", key: "footer.model" },
] as const;

// New tabs on purpose. Following a link in this one would throw away every file in
// the queue, and there is no server holding any of it.
const SiteFooter = () => {
  const { t } = useTranslations();

  return (
    <footer className="border-foreground/10 border-t">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-10 sm:py-12">
        <h2 className="text-base font-medium sm:text-sm">{t("footer.heading")}</h2>

        <p className="text-muted-foreground max-w-[56ch] text-base text-pretty sm:text-sm">
          {t("footer.summary")}
        </p>

        <p className="text-muted-foreground max-w-[56ch] text-base text-pretty sm:text-sm">
          {t("footer.offline")}
        </p>

        <ul className="flex flex-wrap gap-x-6 gap-y-2" role="list">
          {LINKS.map((link) => (
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
