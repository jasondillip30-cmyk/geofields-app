import type { FormEventHandler } from "react";
import { fields } from "./safety-report-form";

export function SafetyActionAssignment({ owners, busy, onSubmit }: {
  owners: { id: string; fullName: string }[];
  busy: boolean;
  onSubmit: FormEventHandler<HTMLFormElement>;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg bg-slate-50 p-3">
      <h3 className="font-semibold">Assign follow-up</h3>
      <label>Action <small>(visible to Office and the assignee; no sensitive details)</small><input name="task" maxLength={300} required className={fields} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>Owner<select name="ownerId" required className={fields} defaultValue=""><option value="" disabled>Choose owner</option>
          {owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.fullName}</option>)}
        </select></label>
        <label>Due date<input name="dueDate" type="date" required className={fields} /></label>
      </div>
      <button className="gf-btn-secondary min-h-11" disabled={busy}>Assign action</button>
    </form>
  );
}
