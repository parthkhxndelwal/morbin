"use client";

import { useEffect, useEffectEvent, useState, type ComponentType } from "react";
import type { BuyDrawer as BuyDrawerType } from "@/app/event/[slug]/buy-drawer";
import { BookNowButton } from "./book-now-button";

type DrawerProps = React.ComponentProps<typeof BuyDrawerType>;

/** The booking sheet's code is fetched on first intent, not with the page. */
const loadDrawer = () => import("@/app/event/[slug]/buy-drawer").then((m) => m.BuyDrawer);

/**
 * The Book-now dock: fixed to the bottom of the screen at every size, so the
 * next step is always one tap away, whatever the visitor is reading.
 *
 * The page ships only this button. The booking sheet loads when the visitor
 * shows intent (hover, focus, touch) and opens on the click; a visitor back
 * from an emailed link (`?resume=1`) gets it straight away.
 */
export function BookingDock({
  detail,
  ...props
}: Omit<DrawerProps, "trigger" | "autoStart"> & { detail: string | null }) {
  const [Drawer, setDrawer] = useState<ComponentType<DrawerProps> | null>(null);
  const [startOnLoad, setStartOnLoad] = useState(false);

  async function open(start: boolean) {
    const C = await loadDrawer();
    setDrawer(() => C);
    if (start) setStartOnLoad(true);
  }

  const resume = useEffectEvent(() => void open(false));
  useEffect(() => {
    if (!props.autoOpen) return;
    const t = setTimeout(resume, 0);
    return () => clearTimeout(t);
  }, [props.autoOpen]);

  const button = (onClick: () => void, label: string) => (
    // The page fades into the background under the dock, so the glass (with
    // its fixed, see-through settings) never sits over busy text.
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center bg-gradient-to-t from-background from-65% to-transparent px-4 pt-12 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto w-full max-w-md drop-shadow-xl">
        <BookNowButton
          label={label}
          detail={detail}
          eventTitle={props.title}
          accentColor={props.accentColor ?? "#7c3aed"}
          onClick={onClick}
          onPrefetch={() => void loadDrawer()}
          height={60}
        />
      </div>
    </div>
  );

  if (!Drawer) return button(() => void open(true), props.ctaLabel || "Book now");
  return <Drawer {...props} autoStart={startOnLoad} trigger={({ onClick, label }) => button(onClick, label)} />;
}
