export type SourceRecordType = "EXPENSE" | "INVENTORY_MOVEMENT";
export type LinkageType = "RIG" | "PROJECT" | "MAINTENANCE";
export type LinkageSuggestionConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface MissingLinkageRow {
  id: string;
  sourceRecordType: SourceRecordType;
  linkageType: LinkageType;
  recordId: string;
  reference: string;
  date: string;
  amount: number;
  currentContext: string;
  recommendedAction: string;
  clientId: string | null;
  projectId: string | null;
  rigId: string | null;
  maintenanceRequestId: string | null;
}

export interface LinkageAiSuggestion {
  rowId: string;
  linkageType: LinkageType;
  suggestedRigId: string | null;
  suggestedRigName: string | null;
  suggestedProjectId: string | null;
  suggestedProjectName: string | null;
  suggestedMaintenanceRequestId: string | null;
  suggestedMaintenanceRequestCode: string | null;
  confidence: LinkageSuggestionConfidence;
  score: number;
  reasoning: string;
}

export interface LinkageCenterPayload {
  filters: {
    clientId: string;
    rigId: string;
    from: string | null;
    to: string | null;
  };
  summary: {
    missingRigCount: number;
    missingProjectCount: number;
    missingMaintenanceCount: number;
    totalRecognizedCostAffected: number;
    fixedToday: number;
  };
  rows: {
    missingRig: MissingLinkageRow[];
    missingProject: MissingLinkageRow[];
    missingMaintenance: MissingLinkageRow[];
  };
  lookups: {
    rigs: Array<{
      id: string;
      name: string;
      status: string;
    }>;
    projects: Array<{
      id: string;
      name: string;
      status: string;
      clientId: string;
      clientName: string;
    }>;
    maintenanceRequests: Array<{
      id: string;
      requestCode: string;
      status: string;
      requestDate: string;
      clientId: string | null;
      clientName: string;
      projectId: string | null;
      projectName: string;
      rigId: string | null;
      rigCode: string;
    }>;
  };
}
