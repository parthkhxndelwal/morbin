"use client";

import { BuyDrawer } from "@/app/event/[slug]/buy-drawer";
import { BookNowButton } from "./book-now-button";

/**
 * The page's one booking drawer, opened from the hero's Book-now button or
 * the sticky bar on small screens — both the same GlassSurface button.
 */
export function EventCta(props: {
  eventId: string;
  slug: string;
  title: string;
  accentColor: string;
  ctaLabel: string;
  utm: { source?: string; medium?: string; campaign?: string };
  autoOpen: boolean;
  testToken: string | null;
}) {
  return (
    <BuyDrawer
      {...props}
      trigger={({ onClick, label }) => (
        <>
          <BookNowButton label={label} eventTitle={props.title} accentColor={props.accentColor} onClick={onClick} />
          <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/80 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md md:hidden">
            <BookNowButton
              label={label}
              eventTitle={props.title}
              accentColor={props.accentColor}
              onClick={onClick}
              height={52}
            />
          </div>
        </>
      )}
    />
  );
}
