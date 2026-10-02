"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { setSupportApprovalAction } from "./actions";

/** The owner's switch for whether Morbin support's changes go live directly. */
export function SupportApprovalCard({ initial, disabled }: { initial: boolean; disabled?: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [pending, startTransition] = useTransition();

  function change(next: boolean) {
    setOn(next);
    startTransition(async () => {
      const r = await setSupportApprovalAction(next);
      if (!r.ok) {
        setOn(!next);
        toast.error(r.error);
        return;
      }
      toast.success(r.message ?? "Saved");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Morbin support</CardTitle>
        <CardDescription>
          When you ask, Morbin&apos;s team can fix an event&apos;s setup for you. You&apos;re notified of every change, and it
          shows in your notifications.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="support-approval">Support changes need my approval</FieldLabel>
            <FieldDescription>
              Support can prepare booking rules for you to publish, but can&apos;t publish, unpublish or cancel your
              events.
            </FieldDescription>
          </FieldContent>
          <Switch id="support-approval" checked={on} onCheckedChange={change} disabled={pending || disabled} />
        </Field>
      </CardContent>
    </Card>
  );
}
