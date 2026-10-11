export type ProjectOperationalStatus = "PLANNED" | "ACTIVE" | "ON_HOLD" | "COMPLETED";

/**
 * Dates establish the initial status. Editing setup data does not silently close
 * an existing project; lifecycle changes require an explicit product action.
 */
export function resolveProjectStatusOnSetupSave({
  existingStatus,
  dateDerivedStatus
}: {
  existingStatus?: ProjectOperationalStatus | null;
  dateDerivedStatus: ProjectOperationalStatus;
}): ProjectOperationalStatus {
  return existingStatus || dateDerivedStatus;
}
