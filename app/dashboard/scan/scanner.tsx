"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CameraIcon,
  CameraOffIcon,
  CircleCheckIcon,
  CircleXIcon,
  KeyboardIcon,
  TriangleAlertIcon,
} from "lucide-react";
// Type-only import: the library itself is loaded on demand when the camera
// starts, so neither the engine nor its worker reaches the first paint.
import type QrScannerInstance from "qr-scanner";
import { checkInAction } from "@/components/features/attendees/actions";
import { DateTime } from "@/components/patterns/money";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { CheckInResult } from "@/lib/checkin";
import { formatDateTime } from "@/lib/format";
import type { Result } from "@/lib/result";
import type { EventStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The door.
 *
 * One component owns the whole desk: which event is being worked, the camera,
 * the keyboard fallback and what the last few tickets did. Every decision about
 * whether a ticket is admitted is made by the server (`checkInAction` →
 * `lib/checkin.ts`); this file only renders what the server said, so the same
 * rule can't drift between the scanner and the attendee list.
 */

/**
 * Minimum gap between two camera decodes. A phone held over one QR re-decodes
 * it many times a second; without this a single attendee would be checked in,
 * then immediately reported as "already checked in" while the door watches.
 */
const COOLDOWN_MS = 1_500;

/** The same payload again inside this window is the same scan, not a new one. */
const DUPLICATE_MS = 5_000;

/** Scans kept in the panel below the result. */
const HISTORY_LIMIT = 10;

/** An event, as the page hands it over: ids, names and dates only. */
export interface ScannerEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  /** Cancelled events never reach the scanner, so the door can't work one. */
  status: Exclude<EventStatus, "CANCELLED">;
  /** Whether the event had already ended when the page was rendered. Decided on the server, so the desk never reads the clock while rendering. */
  past: boolean;
}

type FailureReason = Exclude<CheckInResult, { ok: true }>["reason"];

type CameraState = "idle" | "starting" | "live" | "denied" | "unavailable";

/** What the server said about one scan, plus the raw text that was scanned. */
type ScanOutcome =
  | {
      at: number;
      code: string;
      status: "ok";
      attendeeName: string;
      ticketType: string | null;
      eventTitle: string;
    }
  | {
      at: number;
      code: string;
      status: FailureReason | "unreachable";
      message: string;
      attendeeName?: string;
      checkedInAt?: string | null;
    };

type ScanFailure = Exclude<ScanOutcome, { status: "ok" }>;

/**
 * How each refusal reads at the door. The wording of the refusal itself is the
 * server's; this only decides the shape of the card and the short label used
 * in the recent list.
 */
const FAILURE: Record<
  FailureReason | "unreachable",
  {
    title: string;
    tone: "danger" | "warning" | "info";
    /** Reuses a ticket status where one exists, so the badge says the same thing here as in the attendee list. */
    ticketStatus: string | null;
    label: string;
    hint?: string;
  }
> = {
  invalid: {
    title: "Not a Morbin ticket",
    tone: "danger",
    ticketStatus: null,
    label: "Invalid",
  },
  not_found: {
    title: "No ticket with that code",
    tone: "danger",
    ticketStatus: null,
    label: "Unknown code",
  },
  wrong_event: {
    title: "Ticket for another event",
    tone: "warning",
    ticketStatus: null,
    label: "Other event",
    hint: "Switch the event above if this desk is working more than one.",
  },
  // A re-scan is a refusal at the door, so it must not borrow the ticket's own
  // "Checked in" badge, which reads as admitted.
  already_used: {
    title: "Already checked in",
    tone: "warning",
    ticketStatus: null,
    label: "Already used",
  },
  refunded: {
    title: "Ticket refunded",
    tone: "warning",
    ticketStatus: "REFUNDED",
    label: "Refunded",
  },
  refund_pending: {
    title: "Refund pending",
    tone: "warning",
    ticketStatus: "REFUND_PENDING",
    label: "Refund pending",
    hint: "Check with the organiser before admitting.",
  },
  unreachable: {
    title: "Couldn't check that ticket in",
    tone: "danger",
    ticketStatus: null,
    label: "Failed",
    hint: "The desk may be offline. Try again in a moment.",
  },
};

/** The event a door is most likely working: the nearest one that hasn't ended. */
function nearestEventId(events: ScannerEvent[]): string {
  const upcoming = events.find((e) => !e.past);
  return (upcoming ?? events[0])?.id ?? "";
}

function toOutcome(at: number, scanned: string, r: Result<CheckInResult>): ScanOutcome {
  if (!r.ok) return { at, code: scanned, status: "unreachable", message: r.error };
  if (r.data.ok) {
    return {
      at,
      code: r.data.code,
      status: "ok",
      attendeeName: r.data.attendeeName,
      ticketType: r.data.ticketType,
      eventTitle: r.data.eventTitle,
    };
  }
  return {
    at,
    code: scanned,
    status: r.data.reason,
    message: r.data.message,
    attendeeName: r.data.attendeeName,
    checkedInAt: r.data.checkedInAt,
  };
}

/** Why the camera didn't start, in words a volunteer at a door can act on. */
function describeCameraFailure(error: unknown): { state: CameraState; note: string } {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name?: unknown }).name)
      : "";
  const detail = error instanceof Error ? error.message : String(error);
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || /permission/i.test(detail)) {
    return {
      state: "denied",
      note: "Allow the camera for this site in your browser's address bar, then start it again. You can check tickets in by typing the code below.",
    };
  }
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") {
    return { state: "unavailable", note: "No camera was found on this device. Type ticket codes below instead." };
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return {
      state: "unavailable",
      note: "Another app is using the camera. Close it and start the camera again, or type ticket codes below.",
    };
  }
  return {
    state: "unavailable",
    note: `The camera couldn't start${detail ? ` (${detail})` : ""}. Type ticket codes below instead.`,
  };
}

function OutcomeBadge({ outcome }: { outcome: ScanOutcome }) {
  if (outcome.status === "ok") {
    return (
      <Badge variant="outline" className="border-success/40 text-success">
        <CircleCheckIcon data-icon="inline-start" />
        Checked in
      </Badge>
    );
  }
  const meta = FAILURE[outcome.status];
  if (meta.ticketStatus) return <StatusBadge kind="ticket" value={meta.ticketStatus} />;
  return <Badge variant="outline">{meta.label}</Badge>;
}

export function CheckinScanner({ events }: { events: ScannerEvent[] }) {
  const [eventId, setEventId] = useState(() => nearestEventId(events));
  const [manual, setManual] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ScanOutcome | null>(null);
  const [history, setHistory] = useState<ScanOutcome[]>([]);
  const [camera, setCamera] = useState<CameraState>("idle");
  const [cameraNote, setCameraNote] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const codeRef = useRef<HTMLInputElement | null>(null);
  const scannerRef = useRef<QrScannerInstance | null>(null);
  // Refs, not state: the decode callback fires many times a second and must
  // never be re-created (or re-bound) mid-scan.
  const inFlightRef = useRef(false);
  // Codes typed (or fired by a USB scanner) while a request is in flight wait
  // here and run in order; nothing typed at the desk is ever dropped.
  const manualQueueRef = useRef<string[]>([]);
  // The latest handleScan, for callers that outlive a render (the camera's
  // decode callback, and draining the manual queue).
  const handleScanRef = useRef<(scanned: string, source: "camera" | "manual") => Promise<void>>(
    async () => {},
  );
  const lastDecodeRef = useRef({ at: 0, value: "" });
  const aliveRef = useRef(true);

  const { upcoming, past } = useMemo(
    () => ({
      upcoming: events.filter((e) => !e.past),
      past: events.filter((e) => e.past),
    }),
    [events],
  );

  const selected = events.find((e) => e.id === eventId) ?? null;

  /**
   * One scan, whatever the source. Both the camera and the keyboard funnel
   * through here, so they behave identically: one request at a time, the event
   * chosen above applied to both, and one entry in the recent list either way.
   */
  const handleScan = useCallback(
    async (scanned: string, source: "camera" | "manual") => {
      const now = Date.now();
      // One request at a time. A camera frame that arrives meanwhile is dropped
      // (the code is still in front of the lens and will be read again); a typed
      // code is queued, since nothing would re-send it.
      if (inFlightRef.current) {
        if (source === "manual") {
          manualQueueRef.current.push(scanned);
          setManual("");
        }
        return;
      }
      if (source === "camera") {
        const last = lastDecodeRef.current;
        if (now - last.at < COOLDOWN_MS) return;
        if (last.value === scanned && now - last.at < DUPLICATE_MS) return;
      }
      lastDecodeRef.current = { at: now, value: scanned };
      inFlightRef.current = true;
      setPending(true);
      setResult(null);
      if (source === "manual") setManual("");

      let outcome: ScanOutcome;
      try {
        const r = await checkInAction(scanned, eventId === "" ? null : eventId);
        outcome = toOutcome(now, scanned, r);
      } catch {
        outcome = {
          at: now,
          code: scanned,
          status: "unreachable",
          message: "Couldn't reach Morbin. Check the connection and scan again.",
        };
      }
      if (!aliveRef.current) return;
      setResult(outcome);
      setHistory((prev) => [outcome, ...prev].slice(0, HISTORY_LIMIT));
      inFlightRef.current = false;
      setPending(false);
      const next = manualQueueRef.current.shift();
      if (next !== undefined) {
        void handleScanRef.current(next, "manual");
        return;
      }
      // A USB scanner types into whatever has focus, so the field is kept hot —
      // but not while the camera is live, or the on-screen keyboard would cover
      // the viewport this desk is using.
      if (camera !== "live") codeRef.current?.focus();
    },
    [eventId, camera],
  );

  useEffect(() => {
    handleScanRef.current = handleScan;
  }, [handleScan]);

  const stopCamera = useCallback(() => {
    scannerRef.current?.destroy();
    scannerRef.current = null;
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    setCamera("idle");
    setCameraNote(null);
  }, []);

  /**
   * Started by a button, never on load: a check-in page that asks for the
   * camera the moment it opens is a page nobody trusts on a phone.
   */
  const startCamera = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    setCamera("starting");
    setCameraNote(null);
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setCamera("unavailable");
      setCameraNote("The camera needs a secure (https) address. Type ticket codes below instead.");
      return;
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCamera("unavailable");
      setCameraNote("This browser can't open a camera. Type ticket codes below instead.");
      return;
    }
    try {
      // The decoder worker is a bundler-emitted chunk; nothing is served from /public.
      const { default: QrScanner } = await import("qr-scanner");
      const scanner = new QrScanner(
        video,
        (decoded) => {
          void handleScanRef.current(decoded.data, "camera");
        },
        {
          returnDetailedScanResult: true,
          highlightScanRegion: true,
          preferredCamera: "environment",
          // Five looks a second is plenty at a door and spares the battery;
          // the cooldown below is what actually spaces out the check-ins.
          maxScansPerSecond: 5,
          onDecodeError: (error) => console.warn("[checkin] QR decode failed", error),
        },
      );
      scannerRef.current = scanner;
      await scanner.start();
      if (!aliveRef.current) {
        scanner.destroy();
        scannerRef.current = null;
        return;
      }
      setCamera("live");
    } catch (error) {
      scannerRef.current?.destroy();
      scannerRef.current = null;
      const failure = describeCameraFailure(error);
      setCamera(failure.state);
      setCameraNote(failure.note);
    }
  }, []);

  // Leaving the page must release the camera, or its indicator stays on.
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      scannerRef.current?.destroy();
      scannerRef.current = null;
    };
  }, []);

  function onManualSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = manual.trim();
    if (!value) return;
    void handleScan(value, "manual");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <div className="space-y-6">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Event</CardTitle>
            <CardDescription>
              Pick the event this desk is working. Without one, every ticket of yours is
              admitted.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No events yet. Codes will still be looked up, but there is nothing to check
                in against.
              </p>
            ) : (
              <>
                <NativeSelect
                  aria-label="Event"
                  value={eventId}
                  onChange={(e) => setEventId(e.target.value)}
                  className="w-full"
                >
                  <NativeSelectOption value="">Any event</NativeSelectOption>
                  {upcoming.length > 0 && (
                    <NativeSelectOptGroup label="Upcoming">
                      {upcoming.map((e) => (
                        <NativeSelectOption key={e.id} value={e.id}>
                          {e.title} · {formatDateTime(e.startsAt)}
                        </NativeSelectOption>
                      ))}
                    </NativeSelectOptGroup>
                  )}
                  {past.length > 0 && (
                    <NativeSelectOptGroup label="Past">
                      {past.map((e) => (
                        <NativeSelectOption key={e.id} value={e.id}>
                          {e.title} · {formatDateTime(e.startsAt)}
                        </NativeSelectOption>
                      ))}
                    </NativeSelectOptGroup>
                  )}
                </NativeSelect>
                {selected ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <StatusBadge kind="event" value={selected.status} />
                    <span>
                      {formatDateTime(selected.startsAt)} – {formatDateTime(selected.endsAt)}
                    </span>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    A ticket for another of your events is still accepted, and flagged as such.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Camera</CardTitle>
            <CardDescription>
              Point the camera at the QR code on a ticket. Nothing is recorded or uploaded.
            </CardDescription>
            <CardAction>
              {camera === "live" ? (
                <Button variant="outline" size="sm" onClick={stopCamera}>
                  <CameraOffIcon data-icon="inline-start" />
                  Stop
                </Button>
              ) : (
                <Button size="sm" onClick={startCamera} disabled={camera === "starting"}>
                  {camera === "starting" ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <CameraIcon data-icon="inline-start" />
                  )}
                  Start camera
                </Button>
              )}
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* `relative` so the library's scan-region overlay anchors to the video. */}
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-muted">
              <video
                ref={videoRef}
                muted
                playsInline
                className="size-full object-cover"
                aria-label="Camera preview"
              />
              {camera !== "live" && (
                <div className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-muted-foreground">
                  {camera === "starting"
                    ? "Starting the camera…"
                    : camera === "idle"
                      ? "The camera is off."
                      : "The camera isn't available."}
                </div>
              )}
            </div>
            {cameraNote && (
              <Alert>
                <CameraOffIcon />
                <AlertTitle>
                  {camera === "denied" ? "Camera blocked" : "Camera unavailable"}
                </AlertTitle>
                <AlertDescription>{cameraNote}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Type a code</CardTitle>
            <CardDescription>
              Always available — for a USB barcode scanner, or a printed code.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={onManualSubmit}
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
            >
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="checkin-code">Ticket code or QR payload</Label>
                <Input
                  id="checkin-code"
                  name="code"
                  ref={codeRef}
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="MRB-XXXXXXXX"
                  className="h-9 font-mono uppercase"
                />
              </div>
              <Button type="submit" size="lg" disabled={manual.trim().length === 0}>
                {pending && <Spinner data-icon="inline-start" />}
                Check in
              </Button>
            </form>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <KeyboardIcon className="size-3.5" />
              Press Enter to check in.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card aria-live="polite" aria-atomic="true">
          <CardHeader>
            <CardTitle>Latest scan</CardTitle>
            <CardDescription>What Morbin decided about the last ticket at this desk.</CardDescription>
          </CardHeader>
          <CardContent>
            {pending ? (
              <div className="space-y-3">
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner />
                  Checking the ticket…
                </p>
                <Skeleton className="h-7 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-1/3" />
              </div>
            ) : result === null ? (
              <p className="text-sm text-muted-foreground">
                Nothing scanned yet. Start the camera, or type a code above.
              </p>
            ) : result.status === "ok" ? (
              <div className="space-y-3">
                <Badge variant="outline" className="border-success/40 text-success">
                  <CircleCheckIcon data-icon="inline-start" />
                  Checked in
                </Badge>
                <p className="text-2xl font-semibold tracking-tight">{result.attendeeName}</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                  <dt className="text-muted-foreground">Ticket</dt>
                  <dd>{result.ticketType ?? "—"}</dd>
                  <dt className="text-muted-foreground">Event</dt>
                  <dd className="min-w-0 truncate">{result.eventTitle}</dd>
                  <dt className="text-muted-foreground">Code</dt>
                  <dd className="font-mono text-xs">{result.code}</dd>
                </dl>
              </div>
            ) : (
              <FailurePanel outcome={result} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent scans</CardTitle>
            <CardDescription>The last ten tickets this desk looked at.</CardDescription>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet.</p>
            ) : (
              <ul>
                {history.map((outcome, i) => (
                  <li
                    key={`${outcome.at}-${outcome.code}-${i}`}
                    className="flex items-center gap-3 border-b py-2 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {outcome.status === "ok" ? outcome.attendeeName : (outcome.attendeeName ?? outcome.code)}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        <span className="font-mono">{outcome.code}</span>
                        {" · "}
                        <DateTime value={outcome.at} mode="relative" />
                      </p>
                    </div>
                    <OutcomeBadge outcome={outcome} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FailurePanel({ outcome }: { outcome: ScanFailure }) {
  const meta = FAILURE[outcome.status];
  const warning = meta.tone === "warning";
  return (
    <Alert
      variant={meta.tone === "danger" ? "destructive" : "default"}
      className={cn(
        warning && "border-warning/40 bg-warning/10 [&>[data-slot=alert-title]]:text-warning",
      )}
    >
      {warning ? <TriangleAlertIcon /> : meta.tone === "info" ? <CircleCheckIcon /> : <CircleXIcon />}
      <AlertTitle>{meta.title}</AlertTitle>
      <AlertDescription>
        {outcome.message}
        {outcome.attendeeName && (
          <span className="mt-1 block font-medium text-foreground">{outcome.attendeeName}</span>
        )}
        {outcome.status === "already_used" && outcome.checkedInAt && (
          <span className="mt-1 block">Checked in at <DateTime value={outcome.checkedInAt} />.</span>
        )}
        {meta.hint && <span className="mt-1 block">{meta.hint}</span>}
      </AlertDescription>
    </Alert>
  );
}
