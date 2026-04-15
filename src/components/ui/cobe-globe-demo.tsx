"use client";

import { GlobeInteractive } from "@/components/ui/cobe-globe-interactive";
import { FALLBACK_WORKSPACE_MARKERS } from "@/lib/workspace-launch-markers";

export default function GlobeInteractiveDemo() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center overflow-hidden bg-white p-8">
      <div className="w-full max-w-lg">
        <GlobeInteractive markers={FALLBACK_WORKSPACE_MARKERS} />
      </div>
    </div>
  );
}
