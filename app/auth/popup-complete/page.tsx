/**
 * Where a Google popup lands.
 *
 * A popup is a separate top-level browsing context, so the parent's window
 * never navigates and the parent's JavaScript keeps running. This page exists to
 * close that window and hand control back, which is what lets the drawer advance
 * on its own instead of the buyer returning to the tab to find a dead end.
 *
 * The `popupComplete` helper is shared with the OAuth `redirect` callback, which
 * is the URL Auth.js sends the popup back to when the buyer already has a
 * session and skips the consent screen entirely.
 */
import { PopupComplete } from "@/components/popup-complete";

export default function PopupCompletePage() {
  return <PopupComplete />;
}
