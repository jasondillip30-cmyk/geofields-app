import { redirect } from "next/navigation";
import DrillingReportsPageContent from "./drilling-reports-page-content";

import {
  resolveLegacyFinanceHref,
  type LegacyFinanceSearchParamsInput
} from "@/lib/legacy-finance-redirect";

export default async function DrillingReportsLegacyPage({
  searchParams
}: {
  searchParams?: LegacyFinanceSearchParamsInput;
}) {
  const params = await searchParams;
  if (params?.view === "review") {
    return <DrillingReportsPageContent />;
  }

  redirect(
    await resolveLegacyFinanceHref("/spending", searchParams, {
      view: "drilling-reports"
    })
  );
}

