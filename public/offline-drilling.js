"use strict";

const ownerKey = "gf.offline-drilling.owner";
const reportForm = document.querySelector("#report");
const control = (name) => reportForm.elements.namedItem(name);
const byId = (id) => document.getElementById(id);
let setup = null;
let busy = false;
let correcting = null;
let shellReady = false;
let savedRows = [];

const storage = new Promise((resolve, reject) => {
  try {
    const open = indexedDB.open("gf-offline-drilling", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("data");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  } catch (error) {
    reject(error);
  }
});

async function data(mode, action) {
  const db = await storage;
  return new Promise((resolve, reject) => {
    const tx = db.transaction("data", mode);
    const request = action(tx.objectStore("data"));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const load = (key) => data("readonly", (store) => store.get(key));
const save = (key, value) => data("readwrite", (store) => store.put(value, key));
const queueKey = (owner, id) => "report:" + owner + ":" + id;
const ownedBy = () => localStorage.getItem(ownerKey);
const message = (text) => { byId("message").textContent = text; };

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function project() {
  return setup?.projects.find((item) => item.id === control("projectId").value);
}

function drawProjectFields() {
  const current = project();
  control("rigId").replaceChildren(...(current?.rigs ?? []).map((rig) => new Option(rig.name, rig.id)));
  drawRecentHoles();
  const billing = byId("billing");
  billing.replaceChildren();
  for (const item of current?.extraItems ?? []) {
    const label = document.createElement("label");
    label.textContent = item.label + " (" + item.unit + ")";
    const input = document.createElement("input");
    input.type = "number";
    input.name = "extra:" + item.itemCode;
    input.inputMode = "decimal";
    input.min = "0";
    input.step = "any";
    label.append(input);
    billing.append(label);
  }
}

function drawRecentHoles() {
  const current = project();
  const holes = new Map((current?.recentHoles ?? []).map(({ holeNumber, depth }) => [holeNumber, depth]));
  if (current) {
    for (const row of [...savedRows].reverse()) {
      const payload = row.payload;
      if (row.status === "review" || (row.status === "sent" && (!row.syncedAt || row.syncedAt <= setup.savedAt)) ||
          payload.projectId !== current.id || !Number.isFinite(payload.toMeter)) continue;
      holes.set(payload.holeNumber, Math.max(holes.get(payload.holeNumber) ?? 0, payload.toMeter));
    }
  }
  const picker = byId("recent-hole");
  picker.replaceChildren(new Option("Choose a hole or type one above", ""));
  for (const [hole, depth] of holes) {
    const option = new Option(hole + " (continue at " + depth + " m)", hole);
    option.dataset.depth = String(depth);
    picker.append(option);
  }
  byId("recent-hole-field").hidden = holes.size === 0;
}

function drawSetup() {
  const previous = control("projectId").value;
  control("projectId").replaceChildren(...(setup?.projects ?? []).map((item) => new Option(item.name, item.id)));
  if (setup?.projects.some((item) => item.id === previous)) control("projectId").value = previous;
  drawProjectFields();
  byId("lock").hidden = !setup;
  byId("capture").hidden = !shellReady || !setup?.projects.length;
  byId("readiness").textContent = !shellReady ? "Offline screen is not ready. Connect to the internet and try again."
    : !setup ? "Not ready yet. Sign in online, then prepare field setup."
    : !setup.projects.length ? "No active projects with an active assigned rig were downloaded."
    : "Ready for offline use. Field setup saved " + new Date(setup.savedAt).toLocaleString() + ".";
}

async function entries(owner) {
  if (!owner) return [];
  const prefix = queueKey(owner, "");
  const rows = await data("readonly", (store) => store.getAll(IDBKeyRange.bound(prefix, prefix + "\uffff")));
  return rows.sort((a, b) => a.savedAt.localeCompare(b.savedAt));
}

async function drawQueue() {
  const owner = ownedBy();
  const rows = await entries(owner);
  if (owner !== ownedBy()) return;
  savedRows = rows;
  drawRecentHoles();
  const list = byId("queue");
  list.replaceChildren();
  byId("sync").disabled = busy || !rows.some((row) => row.status === "waiting");
  if (!rows.length) {
    list.textContent = "No saved reports for this account.";
    return;
  }
  for (const row of rows) {
    const item = document.createElement("div");
    item.className = "entry";
    const heading = document.createElement("strong");
    heading.textContent = row.projectName + " / " + row.payload.holeNumber + " / " + row.payload.date;
    const status = document.createElement("p");
    status.textContent = row.status === "sent" ? (row.replayed ? "Already received by GeoFields" : "Submitted for approval")
      : row.status === "review" ? "Needs review: " + row.error
      : "Saved on this phone. Waiting to sync.";
    item.append(heading, status);
    if (row.status === "review") {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "View saved report";
      details.append(summary);
      for (const [label, value] of [
        ["Rig", row.rigName], ["From depth", row.payload.fromMeter], ["To depth", row.payload.toMeter],
        ["Work hours", row.payload.workHours], ["Area", row.payload.areaLocation], ["Lead operator", row.payload.leadOperatorName],
        ["Assistants", row.payload.assistantCount], ["Rig moves", row.payload.rigMoves], ["Standby hours", row.payload.standbyHours],
        ["Delay hours", row.payload.delayHours], ["Delay reason", row.payload.delayReasonCategory], ["Delay note", row.payload.delayReasonNote],
        ["Depth override", row.payload.holeContinuityOverrideReason], ["Comments", row.payload.comments],
        ...Object.entries(row.payload.manualQuantities ?? {})
      ]) {
        if (value === "" || value == null) continue;
        const line = document.createElement("p");
        line.textContent = label + ": " + value;
        details.append(line);
      }
      item.append(details);
    }
    if (row.status === "review" && setup?.projects.some((p) => p.id === row.payload.projectId)) {
      const edit = document.createElement("button");
      edit.type = "button";
      edit.disabled = busy;
      edit.textContent = "Correct report";
      edit.addEventListener("click", () => editReport(row));
      item.append(edit);
    }
    list.append(item);
  }
}

function editReport(row) {
  correcting = row;
  control("projectId").value = row.payload.projectId;
  drawProjectFields();
  for (const [name, value] of Object.entries(row.payload)) {
    const field = control(name);
    if (field && (typeof value === "string" || typeof value === "number")) field.value = value;
  }
  for (const [code, quantity] of Object.entries(row.payload.manualQuantities ?? {})) {
    const field = control("extra:" + code);
    if (field) field.value = quantity;
  }
  byId("more-fields").open = true;
  byId("cancel-edit").hidden = false;
  byId("capture").scrollIntoView();
  control("holeNumber").focus({ preventScroll: true });
}

function resetForm() {
  correcting = null;
  reportForm.reset();
  control("date").value = today();
  drawProjectFields();
  byId("cancel-edit").hidden = true;
}

async function liveSetup() {
  const response = await fetch("/api/offline-drilling", { cache: "no-store", signal: AbortSignal.timeout(12000) });
  if (response.status === 401) return null;
  if (response.status === 403) return false;
  if (!response.ok) throw new Error("Field setup could not be loaded. Try again when you have signal.");
  return response.json();
}

async function prepare() {
  if (busy) return;
  busy = true;
  byId("prepare").disabled = true;
  byId("lock").disabled = true;
  try {
    const live = await liveSetup();
    if (!live) {
      if (live === false) { localStorage.removeItem(ownerKey); setup = null; drawSetup(); }
      throw new Error(live === false ? "This account cannot submit drilling reports." : "Sign in online before preparing field setup.");
    }
    const wasOwner = ownedBy();
    setup = { ...live, savedAt: new Date().toISOString() };
    await save("setup:" + live.ownerId, setup);
    localStorage.setItem(ownerKey, live.ownerId);
    drawSetup();
    if (wasOwner !== live.ownerId) resetForm();
    message(shellReady ? "Field setup refreshed." : "Project data saved, but the offline screen is not ready yet.");
  } catch (error) {
    message(error.message || "Could not prepare offline drilling.");
  } finally {
    byId("prepare").disabled = false;
    byId("lock").disabled = false;
    busy = false;
    await drawQueue();
  }
  await sync();
}

async function sync() {
  if (busy || navigator.onLine === false) return;
  const owner = ownedBy();
  const rows = (await entries(owner)).filter((row) => row.status === "waiting");
  if (busy || !rows.length || owner !== ownedBy()) return;
  busy = true;
  byId("sync").disabled = true;
  byId("prepare").disabled = true;
  byId("lock").disabled = true;
  try {
    for (const row of rows) {
      if (owner !== ownedBy()) break;
      const response = await fetch("/api/drilling-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": row.id },
        body: JSON.stringify(row.payload),
        signal: AbortSignal.timeout(15000)
      });
      const result = await response.json().catch(() => null);
      if (response.ok && typeof result?.reportId === "string") {
        // Keep a confirmation, not the submitted report's private notes or crew details.
        await save(queueKey(owner, row.id), { id: row.id, savedAt: row.savedAt, projectName: row.projectName,
          status: "sent", syncedAt: new Date().toISOString(), replayed: result.replayed === true, payload: {
            date: row.payload.date, holeNumber: row.payload.holeNumber, projectId: row.payload.projectId, toMeter: row.payload.toMeter
          } });
        message(result.replayed ? "GeoFields already received this report. No duplicate was created." : "Report submitted for approval.");
      } else if ([400, 404, 409, 422].includes(response.status)) {
        await save(queueKey(owner, row.id), { ...row, status: "review", error: result?.message || "Review this report online." });
        message("A saved report needs review. No data was discarded.");
        break;
      } else if (response.status === 401 || response.status === 403) {
        message("Sign in online with the same account to send your saved reports.");
        break;
      } else {
        throw new Error("Sync could not be confirmed. Your reports are still saved. Try again when connected.");
      }
    }
  } catch {
    message("Sync could not be confirmed. Your reports are still saved. Try again when connected.");
  } finally {
    busy = false;
    byId("prepare").disabled = false;
    byId("lock").disabled = false;
    await drawQueue();
  }
}

reportForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const selected = project();
  const owner = ownedBy();
  if (!shellReady || !selected || !owner || setup.ownerId !== owner) return;
  const fields = Object.fromEntries(new FormData(reportForm));
  const payload = {
    date: fields.date, projectId: selected.id, rigId: fields.rigId, holeNumber: fields.holeNumber.trim(),
    areaLocation: fields.areaLocation.trim() || "Project site", fromMeter: Number(fields.fromMeter), toMeter: Number(fields.toMeter),
    workHours: Number(fields.workHours), rigMoves: Number(fields.rigMoves), standbyHours: Number(fields.standbyHours),
    delayHours: Number(fields.delayHours), delayReasonCategory: fields.delayReasonCategory,
    delayReasonNote: fields.delayReasonNote, holeContinuityOverrideReason: fields.holeContinuityOverrideReason,
    leadOperatorName: fields.leadOperatorName, assistantCount: Number(fields.assistantCount), comments: fields.comments,
    offlineOwnerId: owner, offlineBillingVersion: selected.billingVersion,
    manualQuantities: Object.fromEntries(selected.extraItems.map(({ itemCode }) => [itemCode, fields["extra:" + itemCode] || ""]))
  };
  if (!payload.holeNumber || payload.toMeter < payload.fromMeter || (payload.delayHours > 0 && !payload.delayReasonCategory)) {
    byId("save-status").textContent = "Check the hole number and depths. Choose a delay reason if you entered delay hours.";
    return;
  }
  const button = reportForm.querySelector("[type=submit]");
  if (button.disabled) return;
  button.disabled = true;
  try {
    const id = correcting?.id || crypto.randomUUID();
    await save(queueKey(owner, id), { id, payload, projectName: selected.name,
      rigName: selected.rigs.find((rig) => rig.id === payload.rigId)?.name,
      status: "waiting", savedAt: new Date().toISOString() });
    resetForm();
    byId("save-status").textContent = "Saved on this phone. Check the queue below for sync status.";
    message("Saved on this phone. Waiting to sync.");
    await drawQueue();
    await sync();
  } catch {
    byId("save-status").textContent = "Could not save on this phone. Keep the form open and try again.";
  } finally {
    button.disabled = false;
  }
});

byId("prepare").addEventListener("click", () => void prepare());
byId("sync").addEventListener("click", () => void sync());
byId("lock").addEventListener("click", () => {
  if (busy) return;
  localStorage.removeItem(ownerKey);
  setup = null;
  resetForm();
  drawSetup();
  void drawQueue();
  message("Offline reports locked. Sign in online with the same account and prepare field setup to reopen them.");
});
byId("cancel-edit").addEventListener("click", resetForm);
control("projectId").addEventListener("change", () => {
  drawProjectFields();
  control("holeNumber").value = "";
  control("fromMeter").value = "";
  control("toMeter").value = "";
});
byId("recent-hole").addEventListener("change", (event) => {
  const option = event.target.selectedOptions[0];
  if (!option?.value) return;
  control("holeNumber").value = option.value;
  control("fromMeter").value = option.dataset.depth;
  control("toMeter").value = "";
});
window.addEventListener("online", () => void sync());
document.addEventListener("visibilitychange", () => { if (!document.hidden) void sync(); });
window.addEventListener("storage", (event) => {
  if (event.key === ownerKey || event.key === null) location.reload();
});

async function start() {
  try {
    const owner = ownedBy();
    setup = owner ? await load("setup:" + owner) : null;
    if (navigator.onLine !== false) {
      try {
        const session = await fetch("/api/auth/session", { cache: "no-store", signal: AbortSignal.timeout(5000) });
        const user = session.ok ? (await session.json()).user : null;
        if (user?.id && owner && user.id !== owner) { localStorage.removeItem(ownerKey); setup = null; }
      } catch { /* A connection without internet should still allow an existing kit to open. */ }
    }
    if ("serviceWorker" in navigator) {
      const cached = await caches.match("/offline-drilling.html");
      shellReady = Boolean(cached);
      const registration = navigator.serviceWorker.register("/offline-drilling-sw.js").catch(() => null);
      if (!shellReady && navigator.onLine !== false) {
        shellReady = Boolean(await Promise.race([
          registration.then((result) => result && navigator.serviceWorker.ready),
          new Promise((resolve) => setTimeout(() => resolve(null), 7000))
        ])) && Boolean(await caches.match("/offline-drilling.html"));
      }
    }
    control("date").value = today();
    drawSetup();
    await drawQueue();
    await sync();
  } catch {
    byId("readiness").textContent = "Offline storage is unavailable on this browser. Use the normal online drilling form.";
  }
}

void start();
