"use client";

import { AccessGate } from "@/components/layout/access-gate";
import { Card } from "@/components/ui/card";

export function ProjectSetupFallback() {
  return (
    <AccessGate permission="projects:manage">
      <div className="gf-page-stack">
        <Card title="Create Project">
          <p className="text-sm text-ink-600">Loading project setup...</p>
        </Card>
      </div>
    </AccessGate>
  );
}
