import { NextResponse, type NextRequest } from "next/server";

import {
  generateLinkageSuggestions,
  type LinkageSuggestionInputRow,
  type LinkageSuggestionLookups
} from "@/lib/ai/linkage-suggestions";
import { requireApiPermission } from "@/lib/auth/api-guard";

interface LinkageSuggestionRequestBody {
  rows?: LinkageSuggestionInputRow[];
  lookups?: LinkageSuggestionLookups;
}

const emptyLookups: LinkageSuggestionLookups = {
  rigs: [],
  projects: [],
  maintenanceRequests: []
};

export async function POST(request: NextRequest) {
  const auth = await requireApiPermission(request, "finance:view");
  if (!auth.ok) {
    return auth.response;
  }

  const body = (await request.json().catch(() => null)) as LinkageSuggestionRequestBody | null;
  const rows = Array.isArray(body?.rows) ? body.rows.filter(Boolean).slice(0, 300) : [];
  const lookups = body?.lookups || emptyLookups;

  if (rows.length === 0) {
    return NextResponse.json({
      ok: true,
      advisoryOnly: true,
      generatedAt: new Date().toISOString(),
      suggestions: []
    });
  }

  const suggestions = await generateLinkageSuggestions({
    rows,
    lookups
  });

  return NextResponse.json({
    ok: true,
    advisoryOnly: true,
    generatedAt: new Date().toISOString(),
    suggestions
  });
}
