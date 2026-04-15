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

export function isWorkspaceLaunchEnabled() {
  const value = process.env.NEXT_PUBLIC_ENABLE_WORKSPACE_LAUNCH;
  if (typeof value === "undefined") {
    return true;
  }
  return isFlagEnabled(value);
}

export function isForecastingEnabled() {
  return isFlagEnabled(process.env.NEXT_PUBLIC_ENABLE_FORECASTING);
}
