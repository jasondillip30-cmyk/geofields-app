import type { Prisma } from "@prisma/client";
import { resolveProjectOperationalStatus, type ProjectOperationalStatus } from "@/lib/project-status-policy";

export class ProjectClosedForDrillingError extends Error {
  constructor() {
    super("Only active projects can receive daily drilling reports.");
  }
}

export async function assertActiveProjectForDrilling(tx: Prisma.TransactionClient, projectId: string) {
  // Share the project row lock with other submissions, while blocking concurrent closeout.
  const [project] = await tx.$queryRaw<Array<{
    status: ProjectOperationalStatus;
    endDate: Date | null;
    closedAt: Date | null;
  }>>`SELECT status::text, "endDate", "closedAt" FROM "Project" WHERE id = ${projectId} FOR SHARE`;
  if (!project || resolveProjectOperationalStatus(project) !== "ACTIVE") {
    throw new ProjectClosedForDrillingError();
  }
}
