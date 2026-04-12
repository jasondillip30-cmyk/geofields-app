import { redirect } from "next/navigation";

import {
  resolveLegacyFinanceHref,
  type LegacyFinanceSearchParamsInput
} from "@/lib/legacy-finance-redirect";

export default async function DrillingReportsLegacyPage({
  searchParams
}: {
  searchParams?: LegacyFinanceSearchParamsInput;
}) {
  redirect(
    await resolveLegacyFinanceHref("/spending", searchParams, {
      view: "drilling-reports"
    })
  );
}

