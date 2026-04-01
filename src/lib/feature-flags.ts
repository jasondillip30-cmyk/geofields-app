function isFlagEnabled(value: string | undefined) {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function isAssistantExperienceEnabled() {
  return isFlagEnabled(process.env.NEXT_PUBLIC_ENABLE_ASSISTANT_EXPERIENCE);
}

export function isDashboardSmartRecommendationsEnabled() {
  return isFlagEnabled(process.env.NEXT_PUBLIC_ENABLE_DASHBOARD_SMART_RECOMMENDATIONS);
}
