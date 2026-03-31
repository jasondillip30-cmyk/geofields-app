import {
  drillReports,
  maintenanceRequests,
  getSummaryReportData,
  getCompanySnapshot
} from "@/lib/mock-data";

export function listDrillReports() {
  return drillReports;
}

export function listMaintenanceRequests() {
  return maintenanceRequests;
}

export function getExecutiveSnapshot() {
  return getCompanySnapshot();
}

export function getSummaryReport() {
  return getSummaryReportData();
}
