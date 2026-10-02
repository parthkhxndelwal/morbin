import { InviteMemberButton, TeamView } from "@/components/features/team/team-view";
import { PageHeader } from "@/components/patterns/page-header";
import { requireOrgSession } from "@/lib/guards";
import { can, memberLabel, memberLabelPlural } from "@/lib/permissions";
import { getTeam } from "@/lib/team";

export const metadata = { title: "Team" };

/**
 * Who can sign in to this organisation. Everyone on the team sees the list;
 * only the owner invites and removes. Members only ever get view and
 * check-in, so the invite copy says exactly that.
 */
export default async function TeamPage() {
  const { org, role, userId } = await requireOrgSession();
  const canManage = can(role, "manageTeam");
  const { members, invites } = await getTeam(org._id.toString(), userId);
  const type = org.type ?? "EVENT";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team"
        description={`The owner runs the organisation; ${memberLabelPlural(type).toLowerCase()} see events and check tickets in at the door.`}
        actions={canManage ? <InviteMemberButton memberLabel={memberLabel(type)} /> : undefined}
      />
      <TeamView members={members} invites={canManage ? invites : []} canManage={canManage} memberLabel={memberLabel(type)} />
    </div>
  );
}
