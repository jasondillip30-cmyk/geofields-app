import type { Dispatch, SetStateAction } from "react";

import { buildScenarioDefinition, generateId, getUsedExistingCategories } from "./forecasting-page-utils";
import {
  CUSTOM_CATEGORY_OPTION,
  MAX_SIMULATION_ROWS,
  type AutoAdjustSummary,
  type SavedScenario,
  type SimulationRow
} from "./forecasting-page-types";

type CreateScenarioEditingActionsParams = {
  categoryNames: string[];
  utilizationChangePct: number;
  simulationRows: SimulationRow[];
  scenarioNameDraft: string;
  savedScenarios: SavedScenario[];
  setSimulationRows: Dispatch<SetStateAction<SimulationRow[]>>;
  setUtilizationChangePct: (value: number) => void;
  setAutoAdjustSummary: (value: AutoAdjustSummary | null) => void;
  setSavedScenarios: Dispatch<SetStateAction<SavedScenario[]>>;
  setScenarioNameDraft: (value: string) => void;
  setActiveEditingScenarioId: (value: string | null | ((current: string | null) => string | null)) => void;
  setComparisonSelection: Dispatch<
    SetStateAction<{
      scenarioAId: string;
      scenarioBId: string;
    }>
  >;
  logScenarioAudit: (payload: {
    action: string;
    entityId: string;
    description: string;
    before?: unknown;
    after?: unknown;
  }) => void;
};

export function createScenarioEditingActions({
  categoryNames,
  utilizationChangePct,
  simulationRows,
  scenarioNameDraft,
  savedScenarios,
  setSimulationRows,
  setUtilizationChangePct,
  setAutoAdjustSummary,
  setSavedScenarios,
  setScenarioNameDraft,
  setActiveEditingScenarioId,
  setComparisonSelection,
  logScenarioAudit
}: CreateScenarioEditingActionsParams) {
  function addSimulationRow() {
    setSimulationRows((current) => {
      if (current.length >= MAX_SIMULATION_ROWS) {
        return current;
      }

      const availableCategory =
        categoryNames.find((category) => !getUsedExistingCategories(current).has(category)) || CUSTOM_CATEGORY_OPTION;

      return [
        ...current,
        {
          id: generateId(),
          categorySelection: availableCategory,
          customCategoryName: "",
          mode: "percent",
          value: 0
        }
      ];
    });
  }

  function removeSimulationRow(rowId: string) {
    setSimulationRows((current) => current.filter((row) => row.id !== rowId));
  }

  function updateSimulationRow(rowId: string, patch: Partial<SimulationRow>) {
    setSimulationRows((current) =>
      current.map((row) => (row.id === rowId ? { ...row, ...patch } : row))
    );
  }

  function setRowCategory(rowId: string, categorySelection: string) {
    setSimulationRows((current) => {
      const usedByOthers = getUsedExistingCategories(current, rowId);
      if (categorySelection !== CUSTOM_CATEGORY_OPTION && usedByOthers.has(categorySelection)) {
        return current;
      }

      return current.map((row) =>
        row.id === rowId
          ? {
              ...row,
              categorySelection,
              customCategoryName: categorySelection === CUSTOM_CATEGORY_OPTION ? row.customCategoryName : ""
            }
          : row
      );
    });
  }

  function resetScenario() {
    setUtilizationChangePct(0);
    setSimulationRows([]);
    setAutoAdjustSummary(null);
  }

  function saveCurrentScenario() {
    const hasAnyChange =
      utilizationChangePct !== 0 ||
      simulationRows.some((row) => row.value !== 0 || row.customCategoryName.trim().length > 0);
    if (!hasAnyChange) {
      return;
    }

    const scenarioName = scenarioNameDraft.trim() || `Scenario ${savedScenarios.length + 1}`;
    const definition = buildScenarioDefinition(utilizationChangePct, simulationRows);
    const nextScenario: SavedScenario = {
      id: generateId(),
      name: scenarioName,
      createdAt: new Date().toISOString(),
      definition
    };

    setSavedScenarios((current) => [nextScenario, ...current]);
    setScenarioNameDraft("");
    logScenarioAudit({
      action: "scenario_save",
      entityId: nextScenario.id,
      description: `Saved scenario "${nextScenario.name}".`,
      after: nextScenario.definition
    });
  }

  function applySavedScenario(scenarioId: string) {
    const scenario = savedScenarios.find((item) => item.id === scenarioId);
    if (!scenario) {
      return;
    }

    setActiveEditingScenarioId(scenarioId);
    setAutoAdjustSummary(null);
    setUtilizationChangePct(scenario.definition.utilizationChangePct);
    setSimulationRows(
      scenario.definition.rows.slice(0, MAX_SIMULATION_ROWS).map((row) => ({
        id: generateId(),
        categorySelection: row.categorySelection,
        customCategoryName: row.customCategoryName,
        mode: row.mode,
        value: row.value
      }))
    );
    logScenarioAudit({
      action: "scenario_load",
      entityId: scenario.id,
      description: `Loaded scenario "${scenario.name}" for live editing.`,
      after: scenario.definition
    });
  }

  function deleteSavedScenario(scenarioId: string) {
    const scenario = savedScenarios.find((item) => item.id === scenarioId);
    if (scenario) {
      logScenarioAudit({
        action: "scenario_delete",
        entityId: scenario.id,
        description: `Deleted scenario "${scenario.name}".`,
        before: scenario.definition
      });
    }

    setSavedScenarios((current) => current.filter((item) => item.id !== scenarioId));
    setComparisonSelection((current) => ({
      scenarioAId: current.scenarioAId === scenarioId ? "none" : current.scenarioAId,
      scenarioBId: current.scenarioBId === scenarioId ? "none" : current.scenarioBId
    }));
    setActiveEditingScenarioId((current) => (current === scenarioId ? null : current));
  }

  return {
    addSimulationRow,
    removeSimulationRow,
    updateSimulationRow,
    setRowCategory,
    resetScenario,
    saveCurrentScenario,
    applySavedScenario,
    deleteSavedScenario
  };
}
