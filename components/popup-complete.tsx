"use client";

import { useEffect } from "react";

/**
 * The tail end of a popup sign-in: tell the opener, then close.
 *
 * Rendered inside a popup, so `window.opener` is the drawer that opened it. The
 * origin is passed explicitly rather than `"*"` so a session that has been
 * redirected somewhere unexpected cannot leak a "signed in" signal to another
 * page.
 */
export function PopupComplete() {
  // Runs after paint so the message is delivered even if the window is being
  // torn down at the same moment.
  useEffect(() => {
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(
          { source: "morbin-auth", status: "complete" },
          window.location.origin,
        );
      }
    } catch {
      /* opener gone, or cross-origin — nothing to do */
    }
    const timer = setTimeout(() => {
      try {
        window.close();
      } catch {
        /* the browser refused; the opener's polling closes us instead */
      }
    }, 80);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#060614] px-6 text-center text-sm text-neutral-400">
      Signed in. Closing…
    </div>
  );
}
