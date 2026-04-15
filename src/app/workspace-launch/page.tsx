import { redirect } from "next/navigation";

import { isWorkspaceLaunchEnabled } from "@/lib/feature-flags";

export default async function WorkspaceLaunchPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isWorkspaceLaunchEnabled()) {
    redirect("/");
  }

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const params = new URLSearchParams();
  params.set("launch", "1");
  const from = asSingleValue(resolvedSearchParams?.from);
  const to = asSingleValue(resolvedSearchParams?.to);
  if (from) {
    params.set("from", from);
  }
  if (to) {
    params.set("to", to);
  }

  redirect(`/rigs?${params.toString()}`);
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
