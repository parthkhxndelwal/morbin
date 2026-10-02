import { DocArticle, docsMetadata } from "../doc-article";

export const metadata = docsMetadata(
  "Roles and access",
  "Who can do what in your organization, and how members are labelled.",
);

export default function RolesPage() {
  return (
    <DocArticle
      title="Roles and access"
      intro="Every organization has exactly one owner and any number of members. The distinction is deliberately small: members can see and can work the door, owners can also change what you are selling and move money."
      sections={[
        {
          h: "Owner",
          p: "One per organization, and the only role that can change anything. An owner can create and publish events, add ticket types, issue refunds, and run check-in. Your account is the owner of any organization you set up.",
        },
        {
          h: "Member",
          p: "Everyone else. A member can open the dashboard, browse your events and ticket types, and run the check-in desk. A member cannot create or edit events, cannot publish, and cannot issue refunds.",
          list: [
            "Can: view the dashboard, view events, run check-in.",
            "Cannot: create, edit or publish events, add ticket types, issue refunds.",
          ],
        },
        {
          h: "How members are labelled",
          p: "The stored role is always Owner or Member. The word you see for a member depends on what kind of organization it is, so the same account reads naturally either way.",
          list: [
            "Event organizer — members are Staff.",
            "Institution — members are Students.",
            "Corporate — members are Staff.",
          ],
        },
        {
          h: "Adding someone",
          p: "The Morbin team adds people to your organization and sets their initial password. There is no self-signup: if someone needs access, ask us and we will create the account and attach it to your organization.",
        },
        {
          h: "Changing someone's role",
          p: "Ask us. Because an organization has exactly one owner, lowering the owner's role is never done in place — ownership is transferred deliberately so nobody is left without an owner.",
        },
        {
          h: "If someone leaves",
          p: "Removing a person takes them out of your organization immediately; they lose access to the dashboard and the check-in desk. Their account is kept, because past orders and issued tickets still reference them, and because the same person may belong to another organization.",
        },
      ]}
      prev={{ href: "/docs/getting-started", title: "Getting started" }}
      next={{ href: "/docs/creating-events", title: "Creating events" }}
    />
  );
}
