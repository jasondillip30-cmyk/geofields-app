import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { GET } from "../src/app/api/offline-drilling/route";
import { POST } from "../src/app/api/drilling-reports/route";
import { signSessionToken } from "../src/lib/auth/session";
import { prisma } from "../src/lib/prisma";

async function main() {
  const url = new URL(process.env.DATABASE_URL || "http://invalid");
  assert.equal(process.env.GEOFIELDS_OFFLINE_TEST, "1");
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.ok(["55448", "55449"].includes(url.port));
  assert.equal(url.pathname, "/geofields_offline_test");
  assert.equal(url.search, "");
  const [db] = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(db.name, "geofields_offline_test");
  assert.equal(await prisma.user.count(), 0, "Use an empty disposable database.");
  const user = await prisma.user.create({ data: { fullName: "Offline QA Field", email: "offline-field@example.invalid", role: "FIELD", passwordHash: "not-a-login" } });
  const other = await prisma.user.create({ data: { fullName: "Other QA Field", email: "offline-other@example.invalid", role: "FIELD", passwordHash: "not-a-login" } });
  const client = await prisma.client.create({ data: { name: "Synthetic client" } });
  const rig = await prisma.rig.create({ data: { rigCode: "OFFLINE-01", serialNumber: "OFFLINE-01", model: "QA", status: "ACTIVE" } });
  const project = await prisma.project.create({ data: {
    name: "Offline QA Project", clientId: client.id, assignedRigId: rig.id, location: "QA", startDate: new Date("2025-01-01"), status: "ACTIVE"
  } });
  await prisma.project.create({ data: {
    name: "Closed QA Project", clientId: client.id, assignedRigId: rig.id, location: "QA", startDate: new Date("2025-01-01"),
    endDate: new Date("2025-01-30"), status: "ACTIVE"
  } });
  const rate = await prisma.projectBillingRateItem.create({ data: {
    projectId: project.id, itemCode: "METERS", label: "Drilling", unit: "meter", unitRate: 120
  } });
  async function request(actor = user, body?: object, key?: string) {
    const token = await signSessionToken({ userId: actor.id, role: actor.role, email: actor.email, name: actor.fullName });
    return new NextRequest("http://localhost/api/" + (body ? "drilling-reports" : "offline-drilling"), {
      method: body ? "POST" : "GET", headers: {
        cookie: "gf_session=" + token, "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {})
      }, ...(body ? { body: JSON.stringify(body) } : {})
    });
  }
  const setup = await GET(await request());
  assert.equal(setup.status, 200);
  assert.match(setup.headers.get("Cache-Control") ?? "", /private, no-store/);
  const kit = await setup.json();
  assert.deepEqual(kit.projects.map((item: { id: string }) => item.id), [project.id]);
  assert.deepEqual(kit.projects[0].recentHoles, []);
  assert.doesNotMatch(JSON.stringify(kit), /unitRate|passwordHash|contractRate/);
  const payload = {
    offlineOwnerId: user.id, offlineBillingVersion: kit.projects[0].billingVersion, projectId: project.id, rigId: rig.id,
    date: "2026-11-12", holeNumber: "QA-01", areaLocation: "QA", fromMeter: 0, toMeter: 12,
    workHours: 2, standbyHours: 0, rigMoves: 0, delayHours: 0, totalMetersDrilled: 999
  };
  const key = randomUUID();
  assert.equal((await POST(await request(other, payload, key))).status, 403);
  assert.equal((await POST(await request(user, { ...payload, date: "2026-02-30" }, key))).status, 400);
  const submissions = await Promise.all(Array.from({ length: 4 }, async () => POST(await request(user, payload, key))));
  assert.deepEqual(submissions.map((response) => response.status).sort(), [200, 200, 200, 201]);
  const responses = await Promise.all(submissions.map((response) => response.json()));
  assert.equal(new Set(responses.map((response) => response.reportId)).size, 1);
  assert.equal((await POST(await request(user, { ...payload, workHours: 3 }, key))).status, 409);
  const report = await prisma.drillReport.findUniqueOrThrow({ where: { id: responses[0].reportId }, include: { billableLines: true } });
  assert.equal(report.approvalStatus, "SUBMITTED");
  assert.equal(report.totalMetersDrilled, 12);
  assert.equal(report.billableAmount, 1440);
  assert.equal(report.billableLines[0]?.quantity, 12);
  assert.equal(await prisma.drillReport.count(), 1);
  assert.equal(await prisma.auditLog.count(), 1);
  assert.equal(await prisma.inventoryMovement.count(), 0);
  const refreshedKit = await (await GET(await request())).json();
  assert.deepEqual(refreshedKit.projects[0].recentHoles, [{ holeNumber: "QA-01", depth: 12 }]);
  await prisma.drillReport.update({ where: { id: report.id }, data: { approvalStatus: "REJECTED" } });
  assert.deepEqual((await (await GET(await request())).json()).projects[0].recentHoles, []);
  await prisma.projectBillingRateItem.update({ where: { id: rate.id }, data: { unitRate: 130 } });
  assert.equal((await POST(await request(user, payload, randomUUID()))).status, 422);
  await prisma.project.update({ where: { id: project.id }, data: { closedAt: new Date() } });
  assert.equal((await POST(await request(user, payload, key))).status, 200);
  await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
  assert.equal((await POST(await request(user, payload, key))).status, 403);
  assert.equal((await GET(await request())).status, 403);
  assert.equal(await prisma.offlineDrillingSubmission.count(), 1);
  console.log("Offline drilling passed: scope, validation, concurrent retry, billing, approval, and account isolation.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
