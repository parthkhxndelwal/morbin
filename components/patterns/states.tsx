import { AlertTriangleIcon, InboxIcon, LockIcon } from "lucide-react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

/** Nothing here yet — with what to do about it. */
export function EmptyState({
  title,
  description,
  icon = <InboxIcon />,
  action,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <Empty className={className}>
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

/** Something failed to load. Shows a retry when one is possible. */
export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this. Try again in a moment.",
  action,
  className,
}: {
  title?: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <EmptyState
      title={title}
      description={description}
      icon={<AlertTriangleIcon />}
      action={action}
      className={className}
    />
  );
}

/** The page is real, but this person's role can't use it. */
export function NoAccessState({
  title = "You don't have access to this",
  description = "Ask your organisation's owner if you need it.",
  className,
}: {
  title?: string;
  description?: React.ReactNode;
  className?: string;
}) {
  return (
    <EmptyState title={title} description={description} icon={<LockIcon />} className={className} />
  );
}
