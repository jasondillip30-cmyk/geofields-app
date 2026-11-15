import { activityLabels, changeActivity, editActivity, elapsedText, shiftTotals } from "./drilling-shift-log.mjs";

export function mountShiftLog({ read, ready, correction, commit, apply }) {
  const get = (id) => document.getElementById(id);
  const buttons = [...get("shift-log").querySelectorAll("[data-activity]")];
  const editor = get("shift-editor");
  const editForm = get("shift-editor-form");
  const editStart = get("shift-edit-start");
  const editEnd = get("shift-edit-end");
  const editType = get("shift-edit-activity");
  const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const localInput = (ms) => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 19);
  let writing = false;
  let editingIndex = -1;
  const running = () => read().at(-1)?.end === null ? read().at(-1) : null;
  const status = (value) => { get("shift-status").textContent = value; };

  function tick() {
    const active = running();
    if (active && !document.hidden) get("shift-clock").textContent = elapsedText(active.start);
  }

  function openEditor(index) {
    if (!ready() || writing) return;
    editingIndex = index;
    const item = read()[index];
    get("shift-editor-title").textContent = item ? "Edit activity" : "Add missed activity";
    editType.value = item?.activity ?? "drilling";
    editStart.value = localInput(item?.start ?? Date.now());
    editEnd.value = item?.end != null ? localInput(item.end) : "";
    get("shift-edit-end-label").hidden = item?.end === null;
    editEnd.required = item?.end !== null;
    get("shift-edit-delete").hidden = !item;
    get("shift-edit-error").textContent = "";
    editor.showModal();
  }

  function render() {
    const entries = read();
    const active = running();
    const invalid = !ready() || writing;
    get("shift-log").hidden = correction();
    get("shift-running").hidden = !active;
    get("shift-activity").textContent = active ? activityLabels[active.activity] : "";
    get("shift-started").textContent = active ? "Started " + new Date(active.start).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
    get("shift-hint").textContent = !ready()
      ? "Choose your project, rig, shift and hole, then tap what you're doing."
      : "Tap when the activity changes. The log saves on this phone.";
    for (const button of buttons) {
      const selected = button.dataset.activity === active?.activity;
      button.disabled = invalid || selected;
      button.setAttribute("aria-pressed", String(selected));
    }
    get("shift-stop").disabled = invalid || !active;
    get("shift-add").disabled = invalid;
    get("shift-apply").disabled = invalid || !entries.length || Boolean(active);
    const list = get("shift-entries");
    list.replaceChildren(...entries.map((item, index) => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary";
      button.disabled = invalid;
      button.textContent = activityLabels[item.activity] + ": " + time(item.start) + " to " +
        (item.end === null ? "now" : time(item.end) + (new Date(item.start).toDateString() === new Date(item.end).toDateString() ? "" : " (next day)"));
      button.setAttribute("aria-label", "Edit " + button.textContent);
      button.addEventListener("click", () => openEditor(index));
      li.append(button);
      return li;
    }));
    const totals = shiftTotals(entries);
    get("shift-totals").textContent = entries.length
      ? `Logged: ${totals.drilling} h drilling · ${totals.delay} h delay · ${totals.standby} h standby` + (active ? " (excludes running activity)." : ".")
      : "No activities logged. You can still enter hours manually.";
    tick();
  }

  async function run(task, message, fromEditor = false) {
    if (writing || !ready()) return;
    writing = true;
    render();
    editForm.querySelector("[type=submit]").disabled = true;
    get("shift-edit-delete").disabled = true;
    try {
      await task();
      if (fromEditor) editor.close();
      status(message);
    } catch (error) {
      if (fromEditor) get("shift-edit-error").textContent = error.message;
      else status(error.message);
    } finally {
      writing = false;
      editForm.querySelector("[type=submit]").disabled = false;
      get("shift-edit-delete").disabled = false;
      render();
    }
  }

  for (const button of buttons) button.addEventListener("click", () =>
    void run(() => commit(changeActivity(read(), button.dataset.activity, Date.now())), "Activity saved on this phone.")
  );
  get("shift-stop").addEventListener("click", () => {
    void run(async () => {
      await commit(changeActivity(read(), null, Date.now()));
      get("shift-timeline").open = true;
    }, "Timing stopped. Review the timeline and fill report hours.");
  });
  get("shift-apply").addEventListener("click", () =>
    void run(() => apply(shiftTotals(read())), "Report hours filled. Check the numbers and add a reason for any delay.")
  );
  get("shift-add").addEventListener("click", () => openEditor(-1));
  get("shift-edit-cancel").addEventListener("click", () => { if (!writing) editor.close(); });
  get("shift-edit-delete").addEventListener("click", () =>
    void run(() => commit(read().filter((_, index) => index !== editingIndex)), "Activity removed.", true)
  );
  editForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void run(() => commit(editActivity(read(), editingIndex, {
      activity: editType.value,
      start: new Date(editStart.value).getTime(),
      end: editEnd.required ? new Date(editEnd.value).getTime() : null
    })), "Activity time updated.", true);
  });
  setInterval(tick, 1000);
  document.addEventListener("visibilitychange", tick);
  return { render, writing: () => writing, reset: () => { if (editor.open) editor.close(); get("shift-timeline").open = false; status(""); } };
}
