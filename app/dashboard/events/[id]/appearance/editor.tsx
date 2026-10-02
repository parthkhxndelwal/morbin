"use client";

import { ExternalLinkIcon, PlusIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { DateTime } from "@/components/patterns/money";
import { publicMediaUrl } from "@/lib/media-public";
import type { CustomField, CustomFieldType, EventBranding } from "@/lib/types";
import { cn } from "@/lib/utils";

const FIELD_TYPES: CustomFieldType[] = ["TEXT", "TEL", "EMAIL", "TEXTAREA", "SELECT"];

/**
 * Appearance and custom fields.
 *
 * A live preview sits next to the controls because the public page is rendered
 * entirely from these values — showing the buyer panel inline means an organiser
 * never has to publish to find out what they made.
 */
export function AppearanceEditor({
  eventId,
  slug,
  title,
  venue,
  startsAt,
  timeZone,
  branding: initial,
}: {
  eventId: string;
  slug: string;
  title: string;
  venue: string;
  startsAt: string;
  /** The event's timezone, so the preview shows when the buyer will see. */
  timeZone: string;
  branding: Omit<EventBranding, "eventId" | "createdAt" | "updatedAt">;
}) {
  const [b, setB] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<"" | "banner" | "social">("");

  function set<K extends keyof typeof b>(k: K, v: (typeof b)[K]) {
    setB((x) => ({ ...x, [k]: v }));
  }

  function patchField(i: number, patch: Partial<CustomField>) {
    set(
      "customFields",
      b.customFields.map((x, j) => (j === i ? { ...x, ...patch } : x)),
    );
  }

  function removeField(i: number) {
    set(
      "customFields",
      b.customFields.filter((_, j) => j !== i),
    );
  }

  function addField() {
    set("customFields", [
      ...b.customFields,
      {
        id: `cf_${Math.random().toString(36).slice(2, 9)}`,
        label: "",
        type: "TEXT",
        required: false,
        collectOn: "CHECKOUT_FORM",
      },
    ]);
  }

  async function upload(kind: "banner" | "social", file: File) {
    setUploading(kind);
    const body = new FormData();
    body.set("file", file);
    body.set("kind", kind);
    const res = await fetch(`/api/events/${eventId}/branding`, { method: "POST", body });
    const out = await res.json().catch(() => ({}));
    setUploading("");
    if (!res.ok) {
      toast.error(out.error ?? "Upload failed.");
      return;
    }
    if (kind === "banner") set("bannerKey", out.key);
    else set("socialImageKey", out.key);
    toast.success("Image uploaded. Remember to save.");
  }

  async function save() {
    setBusy(true);
    const res = await fetch(`/api/events/${eventId}/branding`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(b),
    });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      toast.error(out.error ?? "Could not save.");
      return;
    }
    toast.success("Saved. The public page already shows this.");
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Banner</CardTitle>
            <CardDescription>
              PNG, JPG, WebP or AVIF, up to 5&nbsp;MB. Shown at the top of the page and used as the
              preview image when the link is shared.
            </CardDescription>
            {b.bannerKey && (
              <CardAction>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => set("bannerKey", null)}
                >
                  <Trash2Icon data-icon="inline-start" />
                  Remove
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            {/* The label is the file picker trigger: no button semantics to fake,
                and the input itself stays keyboard reachable. */}
            <label
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "cursor-pointer")}
            >
              {uploading === "banner" ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <UploadIcon data-icon="inline-start" />
              )}
              {uploading === "banner"
                ? "Uploading…"
                : b.bannerKey
                  ? "Replace banner"
                  : "Upload banner"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/avif"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload("banner", f);
                  e.target.value = "";
                }}
              />
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Page</CardTitle>
            <CardDescription>
              The booking button, the accent colour, and what the page shows.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="appearance-cta-label">Button label</FieldLabel>
                <Input
                  id="appearance-cta-label"
                  value={b.ctaLabel}
                  onChange={(e) => set("ctaLabel", e.target.value.slice(0, 40))}
                  placeholder="Book Tickets Now"
                />
                <FieldDescription>Up to 40 characters.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="appearance-accent">Accent colour</FieldLabel>
                <div className="flex items-center gap-2">
                  <Input
                    type="color"
                    value={b.accentColor}
                    onChange={(e) => set("accentColor", e.target.value)}
                    aria-label="Accent colour"
                    className="w-14 shrink-0 cursor-pointer p-1"
                  />
                  <Input
                    id="appearance-accent"
                    value={b.accentColor}
                    onChange={(e) => set("accentColor", e.target.value)}
                    className="font-mono"
                  />
                </div>
                <FieldDescription>
                  Used for the booking button and highlights. A hex colour like #7c3aed.
                </FieldDescription>
              </Field>
              <FieldSet>
                <FieldLegend variant="label">Show on the page</FieldLegend>
                <div className="grid gap-2 sm:grid-cols-2">
                  <ToggleRow
                    id="appearance-show-venue"
                    label="Show venue"
                    on={b.showVenue}
                    onChange={(v) => set("showVenue", v)}
                  />
                  <ToggleRow
                    id="appearance-show-date"
                    label="Show date"
                    on={b.showDate}
                    onChange={(v) => set("showDate", v)}
                  />
                  <ToggleRow
                    id="appearance-show-description"
                    label="Show description"
                    on={b.showDescription}
                    onChange={(v) => set("showDescription", v)}
                  />
                  <ToggleRow
                    id="appearance-show-prices"
                    label="Show prices on the page"
                    on={b.showTicketPreview}
                    onChange={(v) => set("showTicketPreview", v)}
                  />
                </div>
              </FieldSet>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ask at checkout</CardTitle>
            <CardDescription>
              Shown inside the booking drawer, after sign-in. Booking rules can then choose which
              of these each audience is asked for.
            </CardDescription>
            <CardAction>
              <Button variant="outline" size="sm" onClick={addField}>
                <PlusIcon data-icon="inline-start" />
                Add a field
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-3">
            {b.customFields.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No extra questions yet. Buyers are asked their name and email as usual.
              </p>
            ) : (
              b.customFields.map((f, i) => (
                <Card key={f.id} size="sm" className="bg-muted/30">
                  <CardHeader>
                    <Field className="gap-1.5">
                      <FieldLabel htmlFor={`cf-${f.id}-label`} className="text-xs">
                        Question
                      </FieldLabel>
                      <Input
                        id={`cf-${f.id}-label`}
                        value={f.label}
                        onChange={(e) => patchField(i, { label: e.target.value })}
                        placeholder="Full name"
                      />
                    </Field>
                    <CardAction>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => removeField(i)}
                        aria-label={`Remove ${f.label || "field"}`}
                      >
                        <Trash2Icon />
                      </Button>
                    </CardAction>
                  </CardHeader>
                  <CardContent>
                    <FieldGroup>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field>
                          <FieldLabel htmlFor={`cf-${f.id}-type`} className="text-xs">
                            Answer type
                          </FieldLabel>
                          <NativeSelect
                            id={`cf-${f.id}-type`}
                            value={f.type}
                            onChange={(e) =>
                              patchField(i, { type: e.target.value as CustomFieldType })
                            }
                            className="w-full"
                          >
                            {FIELD_TYPES.map((t) => (
                              <NativeSelectOption key={t} value={t}>
                                {t.toLowerCase()}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        </Field>
                        <Field orientation="horizontal" className="sm:mt-6">
                          <Checkbox
                            id={`cf-${f.id}-required`}
                            checked={f.required}
                            onCheckedChange={(v) => patchField(i, { required: !!v })}
                          />
                          <FieldLabel
                            htmlFor={`cf-${f.id}-required`}
                            className="flex-1 cursor-pointer font-normal"
                          >
                            Required
                          </FieldLabel>
                        </Field>
                      </div>
                      {f.type === "SELECT" && (
                        <Field>
                          <FieldLabel htmlFor={`cf-${f.id}-options`} className="text-xs">
                            Options
                          </FieldLabel>
                          <Input
                            id={`cf-${f.id}-options`}
                            value={(f.options ?? []).join(", ")}
                            onChange={(e) =>
                              patchField(i, {
                                options: e.target.value
                                  .split(",")
                                  .map((s) => s.trim())
                                  .filter(Boolean),
                              })
                            }
                            placeholder="Option one, Option two"
                          />
                          <FieldDescription>Separate options with commas.</FieldDescription>
                        </Field>
                      )}
                    </FieldGroup>
                  </CardContent>
                </Card>
              ))
            )}
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={save} disabled={busy}>
            {busy && <Spinner data-icon="inline-start" />}
            {busy ? "Saving…" : "Save changes"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Saving applies to the public page straight away.
          </p>
        </div>
      </div>

      <aside className="lg:sticky lg:top-6">
        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>
              What a buyer sees before they open the booking drawer.
            </CardDescription>
            <CardAction>
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<a href={`/event/${slug}`} target="_blank" rel="noreferrer" />}
              >
                <ExternalLinkIcon data-icon="inline-start" />
                Open page
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg bg-foreground p-4 text-background">
              {b.bannerKey ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={publicMediaUrl(b.bannerKey)} alt="" className="mb-3 w-full rounded-md" />
              ) : null}
              <p
                className="flex flex-wrap items-center gap-x-1.5 text-[10px] font-bold uppercase tracking-widest text-primary"
              >
                {b.showVenue && <span>{venue}</span>}
                {b.showVenue && b.showDate && <span aria-hidden="true">·</span>}
                {b.showDate && <DateTime value={startsAt} timeZone={timeZone} />}
              </p>
              <p className="mt-1 text-base font-bold">{title}</p>
              {b.showDescription && (
                <p className="mt-2 text-xs opacity-70">Your description goes here…</p>
              )}
              <button
                type="button"
                className="mt-4 w-full rounded-lg py-3 text-xs font-bold text-white"
                style={{ backgroundColor: b.accentColor }}
              >
                {b.ctaLabel || "Book Tickets Now"}
              </button>
              {b.customFields.length > 0 && (
                <p className="mt-3 text-[10px] opacity-60">
                  + {b.customFields.length} field{b.customFields.length === 1 ? "" : "s"} asked
                  inside the drawer
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function ToggleRow({
  id,
  label,
  on,
  onChange,
}: {
  id: string;
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Field orientation="horizontal">
      <FieldLabel htmlFor={id} className="flex-1 cursor-pointer font-normal">
        <Switch id={id} checked={on} onCheckedChange={(v) => onChange(!!v)} />
        {label}
      </FieldLabel>
    </Field>
  );
}
