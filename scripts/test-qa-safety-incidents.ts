import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session-config";
import { isSafetyTaskOverdue } from "@/lib/safety-incident-policy";

async function main() {
  assert.equal(process.env.GEOFIELDS_QA, "1");
  assert.equal(process.env.DATABASE_URL, "postgresql://shiftqa@127.0.0.1:55450/geofields_offline_test");
  process.env.AUTH_SECRET = randomBytes(32).toString("hex");
  const { prisma } = await import("@/lib/prisma");
  const { signSessionToken } = await import("@/lib/auth/session");
  const list = await import("@/app/api/safety-incidents/route");
  const detail = await import("@/app/api/safety-incidents/[incidentId]/route");
  const employees = await import("@/app/api/employees/route");
  const employeeEdit = await import("@/app/api/employees/[employeeId]/route");
  try {
    const [identity] = await prisma.$queryRaw<Array<{ db: string; account: string }>>`
      SELECT current_database() AS db, current_user AS account
    `;
    assert.deepEqual(identity, { db: "geofields_offline_test", account: "shiftqa" });
    assert.equal(await prisma.user.count({ where: { NOT: { email: { endsWith: "@example.invalid" } } } }), 0);
    const user = (role: "ADMIN" | "FIELD" | "MECHANIC" | "OFFICE" | "MANAGER") => prisma.user.findFirstOrThrow({ where: { role, isActive: true } });
    const [admin, reporter, owner, coordinator, manager] = await Promise.all([user("ADMIN"), user("FIELD"), user("MECHANIC"), user("OFFICE"), user("MANAGER")]);
    const token = (row: Pick<typeof admin, "id" | "fullName" | "email" | "role">) =>
      signSessionToken({ userId: row.id, name: row.fullName, email: row.email, role: row.role });
    const [adminToken, reporterToken, ownerToken, officeToken, managerToken] = await Promise.all(
      [admin, reporter, owner, coordinator, manager].map(token)
    );
    const request = (session: string | null, method = "GET", input?: object, suffix = "") => new NextRequest(
      "http://localhost/api/safety-incidents" + suffix, {
        method, headers: { ...(session ? { cookie: `${SESSION_COOKIE_NAME}=${session}` } : {}), "content-type": "application/json" },
        ...(input ? { body: JSON.stringify(input) } : {})
      }
    );
    async function expect(responsePromise: Promise<Response>, status: number, noStore = true) {
      const response = await responsePromise;
      const json = await response.json();
      assert.equal(response.status, status, json.message);
      if (noStore) assert.match(response.headers.get("cache-control") ?? "", /no-store/);
      return json;
    }

    const employeeRequest = (session: string, method: string, input?: object) => request(session, method, input);
    const testEmployee = (role: string) => ({
      fullName: "Synthetic QA safety reviewer", email: "safety-review-" + randomUUID() + "@example.invalid",
      password: randomBytes(16).toString("hex"), role, isActive: true
    });
    const reviewerInput = testEmployee("ADMIN");
    await expect(employees.POST(employeeRequest(officeToken, "POST", { ...reviewerInput, isSafetyReviewer: true })), 403, false);
    await expect(employees.POST(employeeRequest(adminToken, "POST", { ...testEmployee("OFFICE"), isSafetyReviewer: true })), 400, false);
    await expect(employees.POST(employeeRequest(adminToken, "POST", { ...testEmployee("MANAGER"), isActive: false, isSafetyReviewer: true })), 400, false);
    const reviewer = (await expect(employees.POST(employeeRequest(adminToken, "POST", reviewerInput)), 201, false)).data;
    assert.equal(reviewer.isSafetyReviewer, false);
    const reviewerToken = await token(reviewer);
    const updateEmployee = (actor: string, id: string, fields: object) =>
      employeeEdit.PUT(employeeRequest(actor, "PUT", fields), { params: Promise.resolve({ employeeId: id }) });
    const appointedInput = testEmployee("MANAGER");
    const appointed = (await expect(employees.POST(employeeRequest(managerToken, "POST", { ...appointedInput, isSafetyReviewer: true })), 201, false)).data;
    const appointedToken = await token(appointed);
    assert.equal(appointed.isSafetyReviewer, true);

    await expect(list.GET(request(null)), 401);
    const payload = {
      submissionKey: randomUUID(), offlineOwnerId: reporter.id, kind: "NEAR_MISS", occurredAt: new Date().toISOString(),
      location: "Synthetic QA workshop", description: "Synthetic QA drill rod close call", injuryObserved: false
    };
    await expect(list.POST(request(ownerToken, "POST", payload)), 403);
    const { id } = await expect(list.POST(request(reporterToken, "POST", payload)), 201);
    assert.equal((await expect(list.POST(request(reporterToken, "POST", payload)), 200)).id, id);
    const ctx = { params: Promise.resolve({ incidentId: id }) };
    const patch = (session: string, command: string, revision: number, changes: object = {}) =>
      detail.PATCH(request(session, "PATCH", { ...changes, command, revision }), ctx);
    await expect(detail.GET(request(reviewerToken), ctx), 404);
    await expect(updateEmployee(officeToken, reviewer.id, { ...reviewerInput, isSafetyReviewer: true }), 403, false);
    const grant = await expect(updateEmployee(managerToken, reviewer.id, { ...reviewerInput, isSafetyReviewer: true }), 200, false);
    assert.equal(grant.data.isSafetyReviewer, true);
    const directory = await expect(employees.GET(employeeRequest(officeToken, "GET")), 200, false);
    assert.equal(directory.data.find((entry: { id: string }) => entry.id === reviewer.id).isSafetyReviewer, true);
    assert.equal(directory.data.find((entry: { id: string }) => entry.id === reviewer.id).passwordHash, undefined);
    const mine = await expect(list.GET(request(reporterToken)), 200);
    const ownRow = mine.reports.find((row: { id: string }) => row.id === id);
    assert.ok(ownRow);
    assert.equal(mine.canReview, false);
    assert.equal(ownRow.description, undefined);
    assert.equal(ownRow.location, undefined);
    await expect(detail.GET(request(reporterToken), ctx), 404);
    assert.equal((await expect(detail.GET(request(reviewerToken), ctx), 200)).incident.description, payload.description);
    assert.equal((await expect(detail.GET(request(appointedToken), ctx), 200)).incident.description, payload.description);
    const demoted = await expect(updateEmployee(adminToken, appointed.id, { ...appointedInput, role: "FIELD" }), 200, false);
    assert.equal(demoted.data.isSafetyReviewer, false);
    await expect(detail.GET(request(appointedToken), ctx), 404);
    await expect(updateEmployee(appointedToken, reviewer.id, { ...reviewerInput, isSafetyReviewer: false }), 403, false);
    const officeList = await expect(list.GET(request(officeToken)), 200);
    assert.equal(officeList.canCoordinate, true);
    assert.equal(officeList.canReview, false);
    const officeRow = officeList.reports.find((row: { id: string }) => row.id === id);
    assert.deepEqual(Object.keys(officeRow).sort(), ["actions", "id", "reportedAt", "state"]);
    const officeCase = await expect(detail.GET(request(officeToken), ctx), 200);
    assert.deepEqual(Object.keys(officeCase.coordination).sort(), ["actions", "brief", "id", "reportedAt", "revision", "state"]);
    assert.equal(officeCase.coordination.brief, null);
    assert.equal(officeCase.incident, undefined);
    await expect(patch(officeToken, "PUBLISH_BRIEF", 0, { brief: "Not authorized" }), 404);
    await expect(patch(officeToken, "TRIAGE", 0), 404);
    await expect(patch(reporterToken, "TRIAGE", 0), 404);
    await expect(patch(reviewerToken, "TRIAGE", 0, { confirmedImpact: "NO_INJURY", highPotential: true }), 200);
    await expect(patch(reviewerToken, "CLOSE", 1, { closeoutNote: "QA closeout" }), 409);
    await expect(patch(reviewerToken, "TRIAGE", 1, {
      confirmedImpact: "NO_INJURY", highPotential: true, findings: "Synthetic QA finding: storage rack stop missing."
    }), 200);
    await expect(patch(reviewerToken, "PUBLISH_BRIEF", 2, { brief: "Arrange a rack inspection." }), 200);
    const visible = await expect(detail.GET(request(officeToken), ctx), 200);
    assert.equal(visible.coordination.brief, "Arrange a rack inspection.");
    assert.equal(JSON.stringify(visible).includes("storage rack stop missing"), false);
    await expect(patch(officeToken, "ADD_ACTION", 2, { ownerId: owner.id, task: "Install a rack stop", dueDate: "2027-01-04" }), 409);
    await expect(patch(officeToken, "ADD_ACTION", 3, { ownerId: owner.id, task: "Install a rack stop", dueDate: "2027-01-04" }), 200);
    const assigned = await expect(list.GET(request(ownerToken)), 200);
    const task = assigned.assignedActions.find((row: { incidentId: string }) => row.incidentId === id);
    assert.equal(task.task, "Install a rack stop");
    assert.deepEqual(task.incident, { revision: 4 });
    await expect(patch(reporterToken, "COMPLETE_ACTION", 4, { actionId: task.id, evidence: "Not mine" }), 404);
    await expect(patch(officeToken, "COMPLETE_ACTION", 4, { actionId: task.id, evidence: "Not mine" }), 404);
    await expect(patch(ownerToken, "COMPLETE_ACTION", 4, { actionId: task.id, evidence: "Synthetic QA replacement installed" }), 200);
    const forOffice = await expect(detail.GET(request(officeToken), ctx), 200);
    assert.equal(forOffice.coordination.actions[0].state, "DONE");
    assert.equal(forOffice.coordination.actions[0].evidence, undefined);
    await expect(patch(officeToken, "VERIFY_ACTION", 5, { actionId: task.id, evidence: "Not authorized" }), 404);
    await expect(patch(officeToken, "CLOSE", 5, { closeoutNote: "Not authorized" }), 404);
    await expect(patch(reviewerToken, "CLOSE", 5, { closeoutNote: "Not verified yet" }), 409);
    await expect(patch(reviewerToken, "VERIFY_ACTION", 5, { actionId: task.id, evidence: "Synthetic QA inspected the stop" }), 200);
    await expect(patch(reviewerToken, "CLOSE", 6, { closeoutNote: "Synthetic QA verified after inspection" }), 200);
    const closed = await expect(detail.GET(request(reviewerToken), ctx), 200);
    assert.equal(closed.incident.state, "CLOSED");
    assert.equal(closed.incident.actions[0].state, "VERIFIED");
    assert.equal(closed.incident.events.length, 8);
    const officeClosed = await expect(detail.GET(request(officeToken), ctx), 200);
    assert.equal(officeClosed.coordination.state, "CLOSED");
    assert.equal(officeClosed.coordination.closeoutNote, undefined);
    assert.deepEqual(officeClosed.owners, []);
    await expect(patch(officeToken, "ADD_ACTION", 7), 409);
    await expect(employeeEdit.DELETE(employeeRequest(managerToken, "DELETE"), { params: Promise.resolve({ employeeId: reviewer.id }) }), 409, false);
    const disabled = await expect(updateEmployee(adminToken, reviewer.id, { ...reviewerInput, isActive: false }), 200, false);
    assert.equal(disabled.data.isSafetyReviewer, false);
    await expect(detail.GET(request(reviewerToken), ctx), 403);
    const reactivated = await expect(updateEmployee(managerToken, reviewer.id, reviewerInput), 200, false);
    assert.equal(reactivated.data.isSafetyReviewer, false);
    await expect(detail.GET(request(reviewerToken), ctx), 404);
    const audits = await prisma.auditLog.findMany({ where: { entityId: reviewer.id, module: "employees" }, orderBy: { createdAt: "asc" } });
    assert.deepEqual(audits.map(({ action, actorId }) => [action, actorId]), [
      ["grant_safety_reviewer", manager.id], ["revoke_safety_reviewer", admin.id]
    ]);
    const afterMidnight = new Date("2027-01-04T21:01:00.000Z");
    assert.equal(isSafetyTaskOverdue({ state: "OPEN", dueDate: "2027-01-04" }, afterMidnight), true);
    assert.equal(isSafetyTaskOverdue({ state: "DONE", dueDate: "2027-01-04" }, afterMidnight), false);
    assert.equal(await prisma.safetyIncident.count({ where: { submissionKey: payload.submissionKey } }), 1);
    console.log("Safety incidents QA passed: reviewer create/edit, Office read-only reviewer flag, audited grant/revoke, stale sessions, Office coordination, and closeout.");
  } finally { await prisma.$disconnect(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
