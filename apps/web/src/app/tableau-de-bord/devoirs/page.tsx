import type { Metadata } from "next";
import Link from "next/link";

import { SUBMISSION_STATUS_LABELS, formatDateTime } from "@belloacademy/shared";

import { Badge, Card, CardBody, EmptyState, Table } from "@/components/ui";
import { requirePageOrganization } from "@/server/page-context";
import { listMyAssignments } from "@/server/services/assignments";

export const metadata: Metadata = { title: "Mes devoirs" };
export const dynamic = "force-dynamic";

export default async function AssignmentsPage() {
  const page = await requirePageOrganization();
  const assignments = await listMyAssignments({
    organizationId: page.organizationId,
    userId: page.user.id,
  });


  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-ink-900">Mes devoirs</h1>
        <p className="mt-1 text-sm text-ink-600">
          Devoirs publiés pour les formations auxquelles vous êtes inscrit, avec leur échéance et leur état.
        </p>
      </header>

      {assignments.length === 0 ? (
        <EmptyState
          title="Aucun devoir pour le moment"
          description="Les devoirs apparaissent ici dès qu'un formateur en publie un dans une formation qui vous concerne."
        />
      ) : (
        <Card>
          <CardBody>
            <Table head={["Devoir", "Formation", "Échéance", "État", ""]}>
              {assignments.map((assignment) => {
                const submission = assignment.submissions[0] ?? null;
                const late = assignment.isOverdue && !submission;
                return (
                  <tr key={assignment.id} className="border-t border-ink-100">
                    <td className="py-3 pr-4 font-medium text-ink-900">{assignment.title}</td>
                    <td className="py-3 pr-4 text-ink-600">{assignment.course.title}</td>
                    <td className="py-3 pr-4 text-ink-600">
                      {assignment.dueAt ? (
                        <span className={late ? "text-danger-700" : undefined}>
                          {formatDateTime(assignment.dueAt)}
                        </span>
                      ) : (
                        <span className="text-ink-400">Sans échéance</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {submission ? (
                        <Badge tone={submission.status === "GRADED" ? "success" : "brand"}>
                          {SUBMISSION_STATUS_LABELS[submission.status]}
                        </Badge>
                      ) : (
                        <Badge tone={late ? "danger" : "neutral"}>
                          {late ? "En retard" : "À déposer"}
                        </Badge>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      <Link
                        href={`/tableau-de-bord/devoirs/${assignment.id}`}
                        className="text-sm font-medium text-brand-700 hover:underline"
                      >
                        {submission ? "Consulter" : "Déposer"}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </Table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
