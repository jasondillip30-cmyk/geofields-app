import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { GET, POST } from "../src/app/api/workshop-updates/route";
import { signSessionToken } from "../src/lib/auth/session";
import type { AuthSession } from "../src/lib/auth/session-types";
import { getPermissionForPath } from "../src/lib/auth/route-permissions";
import { MODE_VISIBLE_NAV_LABELS } from "../src/lib/workspace-mode";
import { prisma } from "../src/lib/prisma";

async function main() {
  const url = new URL(process.env.DATABASE_URL || "http://invalid");
  assert.equal(process.env.GEOFIELDS_WORKSHOP_TEST, "1");
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55446");
  assert.equal(url.pathname, "/geofields_workshop_test");
  assert.equal(url.search, "");
  const [db] = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(db.name, "geofields_workshop_test");
  assert.equal(await prisma.user.count(), 0, "Use an empty disposable database.");
  assert.equal(await prisma.workshopDailyUpdate.count(), 0);
  assert.equal(getPermissionForPath("/workshop-updates"), "workshop-updates:view");
  assert.deepEqual(Object.entries(MODE_VISIBLE_NAV_LABELS).filter(([, labels]) => labels.includes("Workshop Updates")).map(([mode]) => mode), ["workshop"]);

  async function user(role: AuthSession["role"], suffix = "") {
    const email = (role + suffix).toLowerCase() + "@example.invalid";
    return prisma.user.create({ data: { email, fullName: "Workshop " + role, role, passwordHash: "not-a-login" } });
  }
  const mechanic = await user("MECHANIC");
  const office = await user("OFFICE");
  const manager = await user("MANAGER");
  const admin = await user("ADMIN");
  const field = await user("FIELD");
  const staff = await user("STAFF");
  const deactivated = await user("MECHANIC", "-inactive");
  await prisma.user.update({ where: { id: deactivated.id }, data: { isActive: false } });
  const rig = await prisma.rig.create({ data: { rigCode: "QA-RIG-01", model: "Synthetic", serialNumber: "QA-RIG-01" } });
  const otherRig = await prisma.rig.create({ data: { rigCode: "QA-RIG-02", model: "Synthetic", serialNumber: "QA-RIG-02" } });
  const assignee = await prisma.mechanic.create({ data: { fullName: "QA Mechanic", specialization: "Workshop" } });
  const job = await prisma.maintenanceRequest.create({ data: {
    requestCode: "QA-JOB-01", requestDate: new Date("2026-11-12"), rigId: rig.id, mechanicId: assignee.id,
    issueDescription: "Synthetic repair", materialsNeeded: "None", urgency: "LOW", photoUrls: "[]"
  } });

  async function request(actor?: typeof mechanic, query = "", body?: object) {
    const token = actor && await signSessionToken({ userId: actor.id, role: actor.role, email: actor.email, name: actor.fullName });
    return new NextRequest("http://localhost/api/workshop-updates" + query, {
      method: body ? "POST" : "GET",
      headers: { ...(token ? { cookie: "gf_session=" + token } : {}), "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  }

  const post = { workDate: "2026-11-12", workDone: "Checked the hydraulic pump", blockers: "Waiting for seals", nextSteps: "Pressure test" };
  assert.equal((await GET(await request())).status, 401);
  for (const actor of [field, staff, deactivated]) {
    assert.equal((await GET(await request(actor))).status, 403);
    assert.equal((await POST(await request(actor, "", post))).status, 403);
  }
  for (const actor of [office, manager, admin]) {
    assert.equal((await POST(await request(actor, "", post))).status, 403);
  }
  assert.equal((await POST(await request(mechanic, "", { ...post, workDate: "2026-02-30" }))).status, 400);
  assert.equal((await POST(await request(mechanic, "", { ...post, workDone: " " }))).status, 400);
  assert.equal((await POST(await request(mechanic, "", { ...post, workDone: "a".repeat(2001) }))).status, 400);
  assert.equal((await POST(await request(mechanic, "", { ...post, maintenanceRequestId: job.id, rigId: otherRig.id }))).status, 400);

  const saved = await POST(await request(mechanic, "", { ...post, maintenanceRequestId: job.id, authorId: admin.id }));
  assert.equal(saved.status, 201);
  const { update } = await saved.json();
  assert.deepEqual(update.author, { fullName: mechanic.fullName });
  assert.equal(update.rig.rigCode, rig.rigCode);
  assert.equal(update.maintenanceRequest.requestCode, job.requestCode);
  assert.equal((await prisma.workshopDailyUpdate.findUniqueOrThrow({ where: { id: update.id } })).authorId, mechanic.id);
  assert.deepEqual(await prisma.maintenanceRequest.findUnique({ where: { id: job.id } }), job);
  assert.deepEqual(await prisma.rig.findUnique({ where: { id: rig.id } }), rig);
  assert.equal(await prisma.inventoryMovement.count(), 0);
  assert.equal(await prisma.expense.count(), 0);

  for (const actor of [office, manager, admin, mechanic]) {
    const response = await GET(await request(actor, "?from=2026-11-12&to=2026-11-12"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const feed = await response.json();
    assert.deepEqual(feed.updates, [update]);
    assert.equal(Boolean(feed.options), actor.role === "MECHANIC");
    assert.doesNotMatch(JSON.stringify(feed), /passwordHash|@example\.invalid/);
  }
  assert.equal((await GET(await request(office, "?from=2026-11-13&to=2026-11-12"))).status, 400);
  assert.deepEqual((await (await GET(await request(office, "?to=2026-11-11"))).json()).updates, []);

  await prisma.workshopDailyUpdate.createMany({ data: Array.from({ length: 21 }, (_, index) => ({
    workDate: new Date("2026-11-11"), workDone: "Older synthetic update " + index, authorId: mechanic.id
  })) });
  const first = await (await GET(await request(office))).json();
  const second = await (await GET(await request(office, "?cursor=" + first.nextCursor))).json();
  assert.equal(first.updates.length, 20);
  assert.equal(second.updates.length, 2);
  assert.equal(new Set([...first.updates, ...second.updates].map((item) => item.id)).size, 22);
  assert.equal(second.nextCursor, null);
  console.log("Workshop Updates passed: role policy, validation, links, persistence, pagination, and no workflow side effects.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
