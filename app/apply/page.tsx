import { AuthLayout } from "@/components/features/auth/auth-layout";
import { ApplyForm } from "./apply-form";

export const metadata = {
  title: "List your event",
  description: "Apply to sell tickets on Morbin. A person reviews every application.",
};

export default function ApplyPage() {
  return (
    <AuthLayout wide panel={false}>
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">List your event on Morbin</h1>
          <p className="text-sm text-muted-foreground">
            Tell us who you are and what you run. A person reviews every application; once approved you get an email
            to set up your account and can start selling the same day.
          </p>
        </div>
        <ApplyForm />
      </div>
    </AuthLayout>
  );
}
