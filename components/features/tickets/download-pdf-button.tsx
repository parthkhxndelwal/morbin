"use client";

import { DownloadIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/** Downloads an order's PDF (tickets + tax invoice). A 409 means it's still being prepared. */
export function DownloadPdfButton({ orderId }: { orderId: string }) {
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/tickets-pdf`, { cache: "no-store" });
      if (res.status === 409) {
        toast.info("Your tickets are still being prepared. Try again in a minute.");
        return;
      }
      if (!res.ok) {
        toast.error(res.status === 401 ? "Sign in again to download your tickets." : "Couldn't download the PDF.");
        return;
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "tickets.pdf";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="outline" size="sm" onClick={download} disabled={busy}>
      {busy ? <Spinner data-icon="inline-start" /> : <DownloadIcon data-icon="inline-start" />}
      Download PDF
    </Button>
  );
}
