import Link from "next/link";

export interface LegalFooterLink {
  href: string;
  label: string;
}

/**
 * The "Home / Privacy / Terms" strip that closes every legal page and the docs
 * index. Each link is separated by `mr-5` except the last.
 */
export function LegalFooter({ links }: { links: LegalFooterLink[] }) {
  return (
    <div className="mt-12 border-t border-white/10 pt-6 text-xs text-neutral-500">
      {links.map((link, i) => (
        <Link
          key={link.href}
          href={link.href}
          className={`transition-colors hover:text-neutral-300${i < links.length - 1 ? " mr-5" : ""}`}
        >
          {link.label}
        </Link>
      ))}
    </div>
  );
}
