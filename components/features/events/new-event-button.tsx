"use client";

import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/patterns/form-dialog";
import { createEventAction } from "./actions";
import { EventFields } from "./event-fields";

/** Opens the "New event" dialog and takes the owner to the draft on success. */
export function NewEventButton({ label = "New event" }: { label?: string }) {
  return (
    <FormDialog
      trigger={
        <Button>
          <PlusIcon data-icon="inline-start" />
          {label}
        </Button>
      }
      title="New event"
      description="It starts as a draft. Add tickets and publish when you're ready."
      submitLabel="Create draft"
      action={createEventAction}
      onSuccess={(data) => `/dashboard/events/${data.id}`}
      className="sm:max-w-lg"
    >
      {(errors) => <EventFields errors={errors} />}
    </FormDialog>
  );
}
