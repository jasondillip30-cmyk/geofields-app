import { CompanyDashboard } from "@/components/dashboard/company-dashboard";
import { AccessGate } from "@/components/layout/access-gate";

export default function HomePage() {
  return (
    <AccessGate denyBehavior="redirect" permission="dashboard:view">
      <CompanyDashboard />
    </AccessGate>
  );
}
