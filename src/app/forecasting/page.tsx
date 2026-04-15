import { redirect } from "next/navigation";

import { isForecastingEnabled } from "@/lib/feature-flags";
import ForecastingPageContent from "./forecasting-page-content";

export default async function ForecastingPageRoute({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isForecastingEnabled()) {
    const resolvedSearchParams = searchParams ? await searchParams : undefined;
    const params = new URLSearchParams();

    if (resolvedSearchParams) {
      for (const [key, value] of Object.entries(resolvedSearchParams)) {
        const single = asSingleValue(value);
        if (single) {
          params.set(key, single);
        }
      }
    }

    const query = params.toString();
    redirect(query ? `/?${query}` : "/");
  }

  return <ForecastingPageContent />;
}

function asSingleValue(value: string | string[] | undefined) {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.length > 0) {
    return value[0] || "";
  }
  return "";
}
