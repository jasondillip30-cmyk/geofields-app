export const activityLabels = Object.freeze({
  drilling: "Drilling", delay: "Delay", standby: "Standby"
});

function verify(segments, now) {
  for (let i = 0; i < segments.length; i++) {
    const { activity, start, end } = segments[i];
    if (!Object.hasOwn(activityLabels, activity) || !Number.isFinite(start) || start > now ||
        (end !== null && (!Number.isFinite(end) || end <= start || end > now))) {
      throw new Error("Use a valid start and end time, no later than now.");
    }
    if (i > 0 && (segments[i - 1].end === null || segments[i - 1].end > start)) {
      throw new Error("Activities cannot overlap. Adjust the neighboring times first.");
    }
  }
  return segments;
}

export function changeActivity(segments, activity, at, now = Date.now()) {
  const last = segments.at(-1);
  const running = last?.end === null;
  if (running && last.activity === activity) return segments;
  if (!running && activity === null) return segments;
  const next = running ? [...segments.slice(0, -1), { ...last, end: at }] : [...segments];
  if (activity !== null) next.push({ activity, start: at, end: null });
  return verify(next, now);
}

export function editActivity(segments, index, entry, now = Date.now()) {
  const next = segments.filter((_, i) => i !== index);
  next.push(entry);
  return verify(next.sort((a, b) => a.start - b.start), now);
}

export function shiftTotals(segments) {
  const totals = { drilling: 0, standby: 0, delay: 0 };
  for (const { activity, start, end } of segments) {
    if (end !== null) totals[activity] += end - start;
  }
  return Object.fromEntries(Object.entries(totals).map(([key, ms]) => [key, Math.round(ms / 36000) / 100]));
}

export function elapsedText(start, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((value) => String(value).padStart(2, "0")).join(":");
}
