import { redirect } from "next/navigation";

import { resolveLegacyFinanceHref, type LegacyFinanceSearchParamsInput } from "@/lib/legacy-finance-redirect";

export default async function RevenueLegacyPage({
  searchParams
}: {
  searchParams?: LegacyFinanceSearchParamsInput;
}) {
  redirect(await resolveLegacyFinanceHref("/spending", searchParams));
}
