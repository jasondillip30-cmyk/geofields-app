"use client";

import { AccessGate } from "@/components/layout/access-gate";
import { GlobeInteractive } from "@/components/ui/cobe-globe-interactive";
import { FALLBACK_WORKSPACE_MARKERS } from "@/lib/workspace-launch-markers";

export default function WorkspaceLaunchDemoPage() {
  return (
    <AccessGate permission="rigs:view">
      <main className="flex min-h-screen items-center justify-center bg-white px-4 py-8">
        <div className="w-full max-w-2xl">
          <GlobeInteractive markers={FALLBACK_WORKSPACE_MARKERS} />
        </div>
      </main>
    </AccessGate>
  );
}
