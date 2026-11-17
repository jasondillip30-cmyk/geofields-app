export function mountOfflineSafety({ owner, ready, database, linkedContext }) {
  const get = (id) => document.getElementById(id);
  const form = get("offline-safety-form");
  const panel = get("offline-safety-panel");
  const send = get("offline-safety-send");
  const pending = get("offline-safety-pending");
  const status = (text) => { get("offline-safety-status").textContent = text; };
  const prefix = (id) => "safety-pending:" + id + ":";
  const rowsFor = (id) => database("readonly", (store) =>
    store.getAll(IDBKeyRange.bound(prefix(id), prefix(id) + "\uffff")));
  let busy = false;

  function drawContext() {
    const context = linkedContext();
    const label = get("offline-safety-context");
    label.hidden = !context;
    label.querySelector("span").textContent = context ? "Link current " + context.label : "";
  }

  async function render() {
    const account = owner();
    const available = Boolean(account && ready());
    get("offline-safety").hidden = !available;
    if (!available) {
      form.reset();
      panel.open = false;
      pending.textContent = "";
      status("");
      send.hidden = true;
      return;
    }
    drawContext();
    try {
      const rows = await rowsFor(account);
      if (account !== owner() || !ready()) return;
      pending.textContent = rows.length ? rows.length + " incident report(s) saved here, not sent. No one has been notified." : "";
      send.hidden = !rows.length;
      send.disabled = busy || navigator.onLine === false;
    } catch {
      status("Offline incident storage could not be read.");
    }
  }

  panel.addEventListener("toggle", () => {
    if (!panel.open) return;
    const field = form.elements.namedItem("occurredAt");
    const now = new Date();
    if (!field.value) field.value = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    drawContext();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const account = owner();
    if (!account || !ready() || busy) return;
    const submissionKey = crypto.randomUUID();
    const fields = Object.fromEntries(new FormData(form));
    const context = fields.linkContext ? linkedContext() : null;
    const description = fields.description.trim();
    const location = fields.location.trim();
    if (!description || !location) { status("Enter what happened and where."); return; }
    busy = true;
    const button = form.querySelector("[type=submit]");
    button.disabled = true;
    try {
      await database("readwrite", (store) => store.add({
        submissionKey, offlineOwnerId: account, kind: fields.kind, occurredAt: new Date(fields.occurredAt).toISOString(),
        injuryObserved: fields.injuryObserved === "yes" ? true : fields.injuryObserved === "no" ? false : null,
        description, location, immediateResponse: fields.immediateResponse.trim(),
        projectId: context?.projectId ?? null, rigId: context?.rigId ?? null, shift: context?.shift ?? null
      }, prefix(account) + submissionKey));
      if (account === owner() && ready()) {
        form.reset();
        panel.open = false;
        status("Saved on this phone only. Send when connected.");
      }
    } catch { status("Could not save this incident. Keep the form open and try again."); }
    finally {
      busy = false;
      button.disabled = false;
      await render();
    }
  });

  send.addEventListener("click", async () => {
    const account = owner();
    if (!account || !ready() || busy || navigator.onLine === false) return;
    busy = true;
    send.disabled = true;
    try {
      for (const report of await rowsFor(account)) {
        if (owner() !== account || !ready()) return;
        const response = await fetch("/api/safety-incidents", {
          method: "POST", credentials: "same-origin", signal: AbortSignal.timeout(15000),
          headers: { "Content-Type": "application/json" }, body: JSON.stringify(report)
        });
        if (response.status === 401 || response.status === 403) throw new Error("Sign in online with the account that saved the reports. Unsynced reports are still on this phone.");
        if (!response.ok) throw new Error("A report could not be sent. It is still on this phone. Contact your safety reviewer for help.");
        await database("readwrite", (store) => store.delete(prefix(account) + report.submissionKey));
      }
      status("Incident reports recorded in GeoFields. This did not send an emergency alert.");
    } catch (error) { status(error.message || "Could not confirm sending. Retry when connected."); }
    finally {
      busy = false;
      await render();
    }
  });

  window.addEventListener("online", () => void render());
  window.addEventListener("offline", () => void render());
  return { render, drawContext, busy: () => busy };
}
