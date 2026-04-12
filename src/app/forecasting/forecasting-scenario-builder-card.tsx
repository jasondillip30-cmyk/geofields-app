import type React from "react";

import { Card } from "@/components/ui/card";
import { SimulationRowEditor } from "./forecasting-page-components";
import {
  CUSTOM_CATEGORY_OPTION,
  MAX_SIMULATION_ROWS,
  type AutoAdjustSummary,
  type SavedScenario,
  type SimulationRow
} from "./forecasting-page-types";
import {
  clamp,
  formatSignedCurrency,
  formatSignedPercent,
  getUsedExistingCategories,
  parseNumber
} from "./forecasting-page-utils";
import { formatCurrency } from "@/lib/utils";

type ScenarioBuilderCardProps = {
  loading: boolean;
  autoAdjustScenario: () => void;
  resetScenario: () => void;
  utilizationChangePct: number;
  setUtilizationChangePct: React.Dispatch<React.SetStateAction<number>>;
  simulationRows: SimulationRow[];
  addSimulationRow: () => void;
  removeSimulationRow: (rowId: string) => void;
  updateSimulationRow: (rowId: string, patch: Partial<SimulationRow>) => void;
  setRowCategory: (rowId: string, categorySelection: string) => void;
  categoryNames: string[];
  duplicateCustomNameSet: Set<string>;
  impactByRowId: Map<string, { note?: string }>;
  scenarioNameDraft: string;
  setScenarioNameDraft: React.Dispatch<React.SetStateAction<string>>;
  saveCurrentScenario: () => void;
  savedScenarios: SavedScenario[];
  applySavedScenario: (scenarioId: string) => void;
  deleteSavedScenario: (scenarioId: string) => void;
  activeScenarioLines: string[];
  simulationDiff30: number;
  baselineProfit30: number;
  simulatedProfit30: number;
  autoAdjustSummary: AutoAdjustSummary | null;
  compareMode: boolean;
  setCompareMode: React.Dispatch<React.SetStateAction<boolean>>;
  comparisonSelection: {
    scenarioAId: string;
    scenarioBId: string;
  };
  setComparisonSelection: React.Dispatch<
    React.SetStateAction<{
      scenarioAId: string;
      scenarioBId: string;
    }>
  >;
};

export function ScenarioBuilderCard({
  loading,
  autoAdjustScenario,
  resetScenario,
  utilizationChangePct,
  setUtilizationChangePct,
  simulationRows,
  addSimulationRow,
  removeSimulationRow,
  updateSimulationRow,
  setRowCategory,
  categoryNames,
  duplicateCustomNameSet,
  impactByRowId,
  scenarioNameDraft,
  setScenarioNameDraft,
  saveCurrentScenario,
  savedScenarios,
  applySavedScenario,
  deleteSavedScenario,
  activeScenarioLines,
  simulationDiff30,
  baselineProfit30,
  simulatedProfit30,
  autoAdjustSummary,
  compareMode,
  setCompareMode,
  comparisonSelection,
  setComparisonSelection
}: ScenarioBuilderCardProps) {
  return (
    <Card
      title="Scenario Simulation Panel"
      subtitle="Compact strategy builder: pick only the cost changes you want to test"
      action={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={autoAdjustScenario}
            disabled={loading}
            className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            Auto Adjust
          </button>
          <button
            type="button"
            onClick={resetScenario}
            className="rounded-md border border-slate-200 px-2 py-1 text-xs text-ink-700 hover:bg-slate-50"
          >
            Reset Scenario
          </button>
        </div>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium text-ink-900">Rig Utilization</p>
              <p className="text-xs font-medium text-ink-700">{formatSignedPercent(utilizationChangePct)}</p>
            </div>
            <input
              type="range"
              min={-100}
              max={100}
              step={1}
              value={clamp(utilizationChangePct, -100, 100)}
              onChange={(event) => setUtilizationChangePct(Number(event.target.value))}
              className="w-full accent-blue-600"
            />
            <div className="mt-1 flex justify-between text-[11px] text-ink-500">
              <span>-100%</span>
              <span>+100%</span>
            </div>
            <label className="mt-2 block text-xs text-ink-700">
              <span className="mb-1 block">Manual utilization input (%)</span>
              <input
                type="number"
                value={utilizationChangePct}
                onChange={(event) => setUtilizationChangePct(parseNumber(event.target.value))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
              />
            </label>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-ink-900">Cost Simulations</p>
                <p className="text-xs text-ink-600">Up to 3 selected categories at a time.</p>
              </div>
              {simulationRows.length < MAX_SIMULATION_ROWS && (
                <button
                  type="button"
                  onClick={addSimulationRow}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                >
                  Add Simulation
                </button>
              )}
            </div>

            {simulationRows.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm text-ink-600">
                No cost simulations added yet.
              </p>
            ) : (
              <div className="space-y-3">
                {simulationRows.map((row) => {
                  const usedByOthers = getUsedExistingCategories(simulationRows, row.id);
                  const options = categoryNames.filter(
                    (category) => category === row.categorySelection || !usedByOthers.has(category)
                  );
                  const duplicateCustomName =
                    row.categorySelection === CUSTOM_CATEGORY_OPTION &&
                    duplicateCustomNameSet.has(row.customCategoryName.trim().toLowerCase()) &&
                    row.customCategoryName.trim().length > 0;
                  const rowImpact = impactByRowId.get(row.id);

                  return (
                    <SimulationRowEditor
                      key={row.id}
                      row={row}
                      options={options}
                      duplicateCustomName={duplicateCustomName}
                      note={rowImpact?.note}
                      onCategoryChange={(value) => setRowCategory(row.id, value)}
                      onModeChange={(mode) => updateSimulationRow(row.id, { mode })}
                      onValueChange={(value) => updateSimulationRow(row.id, { value })}
                      onCustomNameChange={(value) =>
                        updateSimulationRow(row.id, { customCategoryName: value })
                      }
                      onRemove={() => removeSimulationRow(row.id)}
                    />
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-sm font-medium text-ink-900">Save Scenario</p>
            <p className="mt-1 text-xs text-ink-600">
              Save this simulation setup and reuse it in comparison mode.
            </p>
            <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
              <input
                type="text"
                value={scenarioNameDraft}
                onChange={(event) => setScenarioNameDraft(event.target.value)}
                placeholder="Scenario name (e.g. Cost Cut)"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={saveCurrentScenario}
                className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700"
              >
                Save Scenario
              </button>
            </div>

            <div className="mt-3 space-y-2">
              {savedScenarios.length === 0 ? (
                <p className="text-xs text-ink-600">No saved scenarios yet.</p>
              ) : (
                savedScenarios.slice(0, 6).map((scenario) => (
                  <div
                    key={scenario.id}
                    className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-xs"
                  >
                    <div>
                      <p className="font-medium text-ink-800">{scenario.name}</p>
                      <p className="text-ink-600">
                        {new Date(scenario.createdAt).toLocaleDateString("en-US")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => applySavedScenario(scenario.id)}
                        className="rounded-md border border-slate-200 px-2 py-1 text-ink-700 hover:bg-slate-50"
                      >
                        Load
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteSavedScenario(scenario.id)}
                        className="rounded-md border border-red-200 px-2 py-1 text-red-700 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm font-semibold text-ink-900">Active Scenario Summary</p>
            {activeScenarioLines.length === 0 ? (
              <p className="mt-2 text-sm text-ink-600">No active adjustments yet.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm text-ink-700">
                {activeScenarioLines.map((line, index) => (
                  <li key={`${line}-${index}`}>{line}</li>
                ))}
              </ul>
            )}
            <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2">
              <p className="text-xs text-ink-600">Estimated impact (30 days)</p>
              <p
                className={`text-base font-semibold ${
                  simulationDiff30 > 0
                    ? "text-emerald-700"
                    : simulationDiff30 < 0
                      ? "text-red-700"
                      : "text-ink-800"
                }`}
              >
                {formatSignedCurrency(simulationDiff30)}
              </p>
            </div>
            <p className="mt-2 text-xs text-ink-600">
              Baseline 30-day profit: {formatCurrency(baselineProfit30)}
            </p>
            <p className="text-xs text-ink-600">
              Simulated 30-day profit: {formatCurrency(simulatedProfit30)}
            </p>
          </div>

          {autoAdjustSummary && (
            <div
              className={`rounded-lg border p-3 ${
                autoAdjustSummary.status === "applied"
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-slate-200 bg-slate-50"
              }`}
            >
              <p className="text-sm font-semibold text-ink-900">Auto Adjust Summary</p>
              {autoAdjustSummary.status === "applied" ? (
                <p className="mt-1 text-xs text-emerald-800">
                  Auto Adjust applied using the strongest available driver.
                </p>
              ) : (
                <p className="mt-1 text-xs text-ink-700">
                  Current scenario is already near-optimal under available adjustments.
                </p>
              )}
              <p className="mt-2 text-xs text-ink-700">
                Optimal utilization found: {formatSignedPercent(autoAdjustSummary.newUtilization)}
              </p>
              <p className="text-xs text-ink-700">
                Previous utilization: {formatSignedPercent(autoAdjustSummary.previousUtilization)}
              </p>
              <p className="text-xs text-ink-700">
                Projected 30-day profit: {formatCurrency(autoAdjustSummary.previousProfit30)} to{" "}
                {formatCurrency(autoAdjustSummary.newProfit30)}
              </p>
              <p
                className={`text-xs font-medium ${
                  autoAdjustSummary.profitChange30 > 0
                    ? "text-emerald-700"
                    : autoAdjustSummary.profitChange30 < 0
                      ? "text-red-700"
                      : "text-ink-700"
                }`}
              >
                Improvement: {formatSignedCurrency(autoAdjustSummary.profitChange30)}
              </p>
              <p className="mt-1 text-xs text-ink-700">Driver used: {autoAdjustSummary.driver}</p>
              <p className="text-xs text-ink-700">{autoAdjustSummary.reason}</p>
              <ul className="mt-2 space-y-1 text-xs text-ink-700">
                {autoAdjustSummary.details.map((detail, index) => (
                  <li key={`${detail}-${index}`}>{detail}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-ink-900">Compare Scenarios</p>
              <button
                type="button"
                onClick={() => setCompareMode((current) => !current)}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-ink-700 hover:bg-slate-50"
              >
                {compareMode ? "Hide" : "Show"}
              </button>
            </div>
            <p className="text-xs text-ink-600">
              Baseline is always included. Select up to two saved scenarios.
            </p>
            {compareMode && (
              <div className="mt-2 grid gap-2">
                <label className="text-xs text-ink-700">
                  <span className="mb-1 block">Scenario A</span>
                  <select
                    value={comparisonSelection.scenarioAId}
                    onChange={(event) => {
                      const nextId = event.target.value;
                      setComparisonSelection((current) => ({
                        scenarioAId: nextId,
                        scenarioBId:
                          nextId !== "none" && current.scenarioBId === nextId ? "none" : current.scenarioBId
                      }));
                    }}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  >
                    <option value="none">Select scenario</option>
                    {savedScenarios.map((scenario) => (
                      <option key={scenario.id} value={scenario.id}>
                        {scenario.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-ink-700">
                  <span className="mb-1 block">Scenario B</span>
                  <select
                    value={comparisonSelection.scenarioBId}
                    onChange={(event) => {
                      const nextId = event.target.value;
                      setComparisonSelection((current) => ({
                        scenarioAId:
                          nextId !== "none" && current.scenarioAId === nextId ? "none" : current.scenarioAId,
                        scenarioBId: nextId
                      }));
                    }}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  >
                    <option value="none">Select scenario</option>
                    {savedScenarios.map((scenario) => (
                      <option key={scenario.id} value={scenario.id}>
                        {scenario.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
