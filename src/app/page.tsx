import { CompanyDashboard } from "@/components/dashboard/company-dashboard";
import { AccessGate } from "@/components/layout/access-gate";

export default function HomePage() {
  return (
    <AccessGate permission="dashboard:view">
      <CompanyDashboard />
    </AccessGate>
  );
}
