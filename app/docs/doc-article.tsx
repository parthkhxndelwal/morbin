import Link from "next/link";

export interface DocSection {
  h: string;
  p: string;
  list?: string[];
}

export function DocArticle({
  title,
  intro,
  sections,
  prev,
  next,
}: {
  title: string;
  intro: string;
  sections: DocSection[];
  prev?: { href: string; title: string };
  next?: { href: string; title: string };
}) {
  return (
    <article>
      <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">{title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-neutral-400">{intro}</p>

      <div className="mt-10 space-y-8">
        {sections.map((s) => (
          <section key={s.h}>
            <h2 className="text-lg font-semibold text-white">{s.h}</h2>
            <p className="mt-2 text-sm leading-relaxed">{s.p}</p>
            {s.list && (
              <ul className="mt-3 space-y-2 text-sm leading-relaxed">
                {s.list.map((li) => (
                  <li key={li} className="flex gap-3">
                    <span className="text-neutral-600">·</span>
                    <span>{li}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      <div className="mt-12 flex items-center justify-between border-t border-white/10 pt-6 text-sm">
        {prev ? (
          <Link href={prev.href} className="text-neutral-400 transition-colors hover:text-white">
            ← {prev.title}
          </Link>
        ) : (
          <Link href="/docs" className="text-neutral-400 transition-colors hover:text-white">
            ← All docs
          </Link>
        )}
        {next && (
          <Link href={next.href} className="text-neutral-400 transition-colors hover:text-white">
            {next.title} →
          </Link>
        )}
      </div>
    </article>
  );
}

export const docsMetadata = (title: string, description: string) => ({
  title,
  description,
});
