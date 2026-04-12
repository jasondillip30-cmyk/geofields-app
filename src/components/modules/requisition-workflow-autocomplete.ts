"use client";

import { useEffect, useMemo, useState } from "react";
import type { Dispatch, KeyboardEvent, SetStateAction } from "react";

import { normalizeNameForStorage } from "@/lib/name-normalization";
import { normalizeSearchText } from "./requisition-workflow-helpers";
import type {
  InventoryItemSuggestion,
  RequisitionCategoryOption,
  RequisitionFormState,
  RequisitionSubcategoryOption,
  VendorSuggestion
} from "./requisition-workflow-types";

interface UseRequisitionWorkflowAutocompleteArgs {
  form: RequisitionFormState;
  setForm: Dispatch<SetStateAction<RequisitionFormState>>;
  categoryOptions: RequisitionCategoryOption[];
  subcategoryOptions: RequisitionSubcategoryOption[];
  setSetupSubcategories: Dispatch<SetStateAction<RequisitionSubcategoryOption[]>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setNotice: Dispatch<SetStateAction<string | null>>;
}

export function useRequisitionWorkflowAutocomplete({
  form,
  setForm,
  categoryOptions,
  subcategoryOptions,
  setSetupSubcategories,
  setError,
  setNotice
}: UseRequisitionWorkflowAutocompleteArgs) {
  const [vendorSuggestions, setVendorSuggestions] = useState<VendorSuggestion[]>([]);
  const [vendorSuggestionLoading, setVendorSuggestionLoading] = useState(false);
  const [vendorSuggestionStatus, setVendorSuggestionStatus] = useState<
    "idle" | "ready" | "empty"
  >("idle");
  const [vendorFocused, setVendorFocused] = useState(false);
  const [activeVendorSuggestionIndex, setActiveVendorSuggestionIndex] = useState(-1);
  const [creatingVendor, setCreatingVendor] = useState(false);

  const [inventorySuggestions, setInventorySuggestions] = useState<InventoryItemSuggestion[]>([]);
  const [inventorySuggestionLoading, setInventorySuggestionLoading] = useState(false);
  const [inventorySuggestionStatus, setInventorySuggestionStatus] = useState<
    "idle" | "ready" | "empty"
  >("idle");
  const [itemNameFocused, setItemNameFocused] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);

  const [subcategoryFocused, setSubcategoryFocused] = useState(false);
  const [activeSubcategorySuggestionIndex, setActiveSubcategorySuggestionIndex] = useState(-1);
  const [creatingSubcategory, setCreatingSubcategory] = useState(false);

  const normalizedSubcategoryQuery = normalizeSearchText(form.subcategory);
  const filteredSubcategorySuggestions = useMemo(
    () =>
      subcategoryOptions
        .filter((subcategory) =>
          normalizeSearchText(subcategory.name).includes(normalizedSubcategoryQuery)
        )
        .slice(0, 6),
    [normalizedSubcategoryQuery, subcategoryOptions]
  );

  const showItemSuggestions =
    itemNameFocused &&
    form.itemName.trim().length >= 2 &&
    (inventorySuggestionLoading || inventorySuggestionStatus !== "idle");

  const showVendorSuggestions =
    vendorFocused &&
    form.requestedVendorName.trim().length >= 2 &&
    (vendorSuggestionLoading || vendorSuggestionStatus !== "idle");

  const showCreateVendorOption =
    showVendorSuggestions &&
    !vendorSuggestionLoading &&
    !creatingVendor &&
    vendorSuggestions.length === 0 &&
    form.requestedVendorName.trim().length >= 2;

  const showSubcategorySuggestions =
    subcategoryFocused &&
    form.categoryId.trim().length > 0 &&
    form.subcategory.trim().length >= 1;

  const showCreateSubcategoryOption =
    showSubcategorySuggestions &&
    filteredSubcategorySuggestions.length === 0 &&
    form.subcategory.trim().length >= 1;

  useEffect(() => {
    const searchTerm = form.requestedVendorName.trim();
    if (searchTerm.length < 2) {
      setVendorSuggestions([]);
      setVendorSuggestionStatus("idle");
      setVendorSuggestionLoading(false);
      setActiveVendorSuggestionIndex(-1);
      return;
    }

    const controller = new AbortController();
    const normalizedSearchTerm = normalizeSearchText(searchTerm);
    const timeout = window.setTimeout(() => {
      void (async () => {
        setVendorSuggestionLoading(true);
        try {
          const query = new URLSearchParams();
          query.set("search", searchTerm);
          query.set("limit", "6");
          const response = await fetch(`/api/vendors?${query.toString()}`, {
            cache: "no-store",
            signal: controller.signal
          });
          const payload = (await response.json().catch(() => null)) as
            | {
                data?: Array<{
                  id?: string;
                  name?: string;
                  additionalInfo?: string | null;
                }>;
              }
            | null;
          if (!response.ok || controller.signal.aborted) {
            setVendorSuggestions([]);
            setVendorSuggestionStatus("empty");
            return;
          }
          const nextSuggestions = Array.isArray(payload?.data)
            ? payload.data
                .map((entry) => ({
                  id: typeof entry.id === "string" ? entry.id : "",
                  name: typeof entry.name === "string" ? entry.name.trim() : "",
                  additionalInfo:
                    typeof entry.additionalInfo === "string" && entry.additionalInfo.trim().length > 0
                      ? entry.additionalInfo.trim()
                      : null
                }))
                .filter((entry) => entry.id && entry.name)
                .filter((entry) => normalizeSearchText(entry.name).includes(normalizedSearchTerm))
                .slice(0, 6)
            : [];
          setVendorSuggestions(nextSuggestions);
          setVendorSuggestionStatus(nextSuggestions.length > 0 ? "ready" : "empty");
          setActiveVendorSuggestionIndex(-1);
        } catch {
          if (!controller.signal.aborted) {
            setVendorSuggestions([]);
            setVendorSuggestionStatus("empty");
            setActiveVendorSuggestionIndex(-1);
          }
        } finally {
          if (!controller.signal.aborted) {
            setVendorSuggestionLoading(false);
          }
        }
      })();
    }, 220);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [form.requestedVendorName]);

  useEffect(() => {
    const searchTerm = form.itemName.trim();
    if (searchTerm.length < 2) {
      setInventorySuggestions([]);
      setInventorySuggestionStatus("idle");
      setInventorySuggestionLoading(false);
      setActiveSuggestionIndex(-1);
      return;
    }

    const controller = new AbortController();
    const normalizedSearchTerm = normalizeSearchText(searchTerm);
    const timeout = window.setTimeout(() => {
      void (async () => {
        setInventorySuggestionLoading(true);
        try {
          const query = new URLSearchParams();
          query.set("search", searchTerm);
          query.set("status", "ACTIVE");
          const response = await fetch(`/api/inventory/items?${query.toString()}`, {
            cache: "no-store",
            signal: controller.signal
          });
          const payload = (await response.json().catch(() => null)) as
            | {
                data?: Array<{
                  id?: string;
                  name?: string;
                  sku?: string;
                  category?: string;
                }>;
              }
            | null;
          if (!response.ok || controller.signal.aborted) {
            setInventorySuggestions([]);
            setInventorySuggestionStatus("empty");
            return;
          }
          const nextSuggestions = Array.isArray(payload?.data)
            ? payload.data
                .map((entry) => ({
                  id: typeof entry.id === "string" ? entry.id : "",
                  name: typeof entry.name === "string" ? entry.name.trim() : "",
                  sku: typeof entry.sku === "string" ? entry.sku.trim() : "",
                  category:
                    typeof entry.category === "string" && entry.category.trim().length > 0
                      ? entry.category.trim()
                      : "Materials"
                }))
                .filter((entry) => entry.id && entry.name)
                .filter((entry) => {
                  const searchable = normalizeSearchText(
                    `${entry.name} ${entry.sku} ${entry.category}`
                  );
                  return searchable.includes(normalizedSearchTerm);
                })
                .slice(0, 6)
            : [];
          setInventorySuggestions(nextSuggestions);
          setInventorySuggestionStatus(nextSuggestions.length > 0 ? "ready" : "empty");
          setActiveSuggestionIndex(-1);
        } catch {
          if (!controller.signal.aborted) {
            setInventorySuggestions([]);
            setInventorySuggestionStatus("empty");
            setActiveSuggestionIndex(-1);
          }
        } finally {
          if (!controller.signal.aborted) {
            setInventorySuggestionLoading(false);
          }
        }
      })();
    }, 220);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [form.itemName]);

  function applyVendorSuggestion(suggestion: VendorSuggestion) {
    setForm((current) => ({
      ...current,
      requestedVendorId: suggestion.id,
      requestedVendorName: suggestion.name
    }));
    setVendorFocused(false);
    setVendorSuggestions([]);
    setVendorSuggestionStatus("idle");
    setActiveVendorSuggestionIndex(-1);
  }

  async function createVendorFromInput() {
    if (creatingVendor) {
      return;
    }
    const candidate = normalizeNameForStorage(form.requestedVendorName);
    if (candidate.length < 2) {
      return;
    }

    setCreatingVendor(true);
    try {
      const response = await fetch("/api/vendors", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ name: candidate, source: "request_flow" })
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            message?: string;
            created?: boolean;
            data?: {
              id?: string;
              name?: string;
              additionalInfo?: string | null;
            };
          }
        | null;

      if (!response.ok) {
        throw new Error(payload?.message || "Failed to create vendor.");
      }

      const createdId = typeof payload?.data?.id === "string" ? payload.data.id : "";
      const createdName = typeof payload?.data?.name === "string" ? payload.data.name.trim() : "";
      if (!createdId || !createdName) {
        throw new Error("Vendor was created but response was invalid.");
      }

      if (payload?.created === false) {
        setNotice("Using existing vendor.");
      }

      applyVendorSuggestion({
        id: createdId,
        name: createdName,
        additionalInfo:
          typeof payload?.data?.additionalInfo === "string" &&
          payload.data.additionalInfo.trim().length > 0
            ? payload.data.additionalInfo.trim()
            : null
      });
    } catch (vendorError) {
      setError(vendorError instanceof Error ? vendorError.message : "Failed to create vendor.");
    } finally {
      setCreatingVendor(false);
    }
  }

  function closeVendorSuggestions() {
    setVendorFocused(false);
    setActiveVendorSuggestionIndex(-1);
  }

  function applyInventorySuggestion(suggestion: InventoryItemSuggestion) {
    const linkedCategory =
      categoryOptions.find(
        (entry) => normalizeSearchText(entry.name) === normalizeSearchText(suggestion.category)
      ) || null;
    setForm((current) => ({
      ...current,
      itemName: suggestion.name,
      categoryId: linkedCategory?.id || current.categoryId,
      category: linkedCategory?.name || current.category,
      subcategoryId: linkedCategory?.id === current.categoryId ? current.subcategoryId : "",
      subcategory: linkedCategory?.id === current.categoryId ? current.subcategory : ""
    }));
    setItemNameFocused(false);
    setInventorySuggestions([]);
    setInventorySuggestionStatus("idle");
    setActiveSuggestionIndex(-1);
  }

  function closeItemSuggestions() {
    setItemNameFocused(false);
    setActiveSuggestionIndex(-1);
  }

  function applySubcategorySuggestion(subcategory: RequisitionSubcategoryOption) {
    setForm((current) => ({
      ...current,
      subcategoryId: subcategory.id,
      subcategory: subcategory.name
    }));
    setSubcategoryFocused(false);
    setActiveSubcategorySuggestionIndex(-1);
  }

  async function createSubcategoryFromInput() {
    if (creatingSubcategory) {
      return;
    }
    const candidate = normalizeNameForStorage(form.subcategory);
    if (!form.categoryId || !candidate) {
      return;
    }

    setCreatingSubcategory(true);
    try {
      const response = await fetch("/api/requisitions/setup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "create_subcategory",
          categoryId: form.categoryId,
          name: candidate,
          source: "request_flow"
        })
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            message?: string;
            data?: {
              created?: boolean;
              subcategory?: {
                id?: string;
                name?: string;
                categoryId?: string;
              };
            };
          }
        | null;
      if (!response.ok) {
        throw new Error(payload?.message || "Failed to create subcategory.");
      }

      const created = payload?.data?.subcategory;
      const createdId = typeof created?.id === "string" ? created.id : "";
      const createdName = typeof created?.name === "string" ? created.name.trim() : "";
      const createdCategoryId =
        typeof created?.categoryId === "string" ? created.categoryId : form.categoryId;
      if (!createdId || !createdName || !createdCategoryId) {
        throw new Error("Subcategory was created but response was invalid.");
      }
      if (payload?.data?.created === false) {
        setNotice("Using existing subcategory.");
      }

      const createdOption: RequisitionSubcategoryOption = {
        id: createdId,
        name: createdName,
        categoryId: createdCategoryId
      };
      setSetupSubcategories((current) => {
        if (current.some((entry) => entry.id === createdOption.id)) {
          return current;
        }
        return [...current, createdOption];
      });
      applySubcategorySuggestion(createdOption);
    } catch (subcategoryError) {
      setError(
        subcategoryError instanceof Error
          ? subcategoryError.message
          : "Failed to create subcategory."
      );
    } finally {
      setCreatingSubcategory(false);
    }
  }

  function closeSubcategorySuggestions() {
    setSubcategoryFocused(false);
    setActiveSubcategorySuggestionIndex(-1);
  }

  function applyCategorySelection(categoryId: string) {
    const selectedCategory = categoryOptions.find((entry) => entry.id === categoryId) || null;
    setForm((current) => ({
      ...current,
      categoryId: selectedCategory?.id || "",
      category: selectedCategory?.name || "",
      subcategoryId: "",
      subcategory: ""
    }));
    setActiveSubcategorySuggestionIndex(-1);
  }

  function handleVendorNameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      closeVendorSuggestions();
      return;
    }

    const suggestionCount = vendorSuggestions.length + (showCreateVendorOption ? 1 : 0);
    if (!showVendorSuggestions || suggestionCount === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveVendorSuggestionIndex((current) =>
        Math.min(current < 0 ? 0 : current + 1, suggestionCount - 1)
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveVendorSuggestionIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      if (activeVendorSuggestionIndex >= 0) {
        event.preventDefault();
        const selectedVendor = vendorSuggestions[activeVendorSuggestionIndex];
        if (selectedVendor) {
          applyVendorSuggestion(selectedVendor);
          return;
        }
        if (showCreateVendorOption) {
          void createVendorFromInput();
          return;
        }
      }
      if (showCreateVendorOption && vendorSuggestions.length === 0) {
        event.preventDefault();
        void createVendorFromInput();
      }
    }
  }

  function handleItemNameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      closeItemSuggestions();
      return;
    }
    if (!showItemSuggestions || inventorySuggestions.length === 0) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggestionIndex((current) =>
        Math.min(current < 0 ? 0 : current + 1, inventorySuggestions.length - 1)
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestionIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter" && activeSuggestionIndex >= 0) {
      event.preventDefault();
      const selected = inventorySuggestions[activeSuggestionIndex];
      if (selected) {
        applyInventorySuggestion(selected);
      }
    }
  }

  function handleSubcategoryKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      closeSubcategorySuggestions();
      return;
    }
    const suggestionCount =
      filteredSubcategorySuggestions.length + (showCreateSubcategoryOption ? 1 : 0);
    if (!showSubcategorySuggestions || suggestionCount === 0) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSubcategorySuggestionIndex((current) =>
        Math.min(current < 0 ? 0 : current + 1, suggestionCount - 1)
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSubcategorySuggestionIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      if (activeSubcategorySuggestionIndex >= 0) {
        event.preventDefault();
        const selected = filteredSubcategorySuggestions[activeSubcategorySuggestionIndex];
        if (selected) {
          applySubcategorySuggestion(selected);
          return;
        }
        if (showCreateSubcategoryOption) {
          void createSubcategoryFromInput();
          return;
        }
      }
      if (showCreateSubcategoryOption && filteredSubcategorySuggestions.length === 0) {
        event.preventDefault();
        void createSubcategoryFromInput();
      }
    }
  }

  return {
    activeSuggestionIndex,
    activeSubcategorySuggestionIndex,
    activeVendorSuggestionIndex,
    applyCategorySelection,
    applyInventorySuggestion,
    applySubcategorySuggestion,
    applyVendorSuggestion,
    closeItemSuggestions,
    closeSubcategorySuggestions,
    closeVendorSuggestions,
    createSubcategoryFromInput,
    createVendorFromInput,
    creatingSubcategory,
    creatingVendor,
    filteredSubcategorySuggestions,
    handleItemNameKeyDown,
    handleSubcategoryKeyDown,
    handleVendorNameKeyDown,
    inventorySuggestionLoading,
    inventorySuggestionStatus,
    inventorySuggestions,
    itemNameFocused,
    setActiveSubcategorySuggestionIndex,
    setActiveSuggestionIndex,
    setActiveVendorSuggestionIndex,
    setItemNameFocused,
    setSubcategoryFocused,
    setVendorFocused,
    showCreateSubcategoryOption,
    showCreateVendorOption,
    showItemSuggestions,
    showSubcategorySuggestions,
    showVendorSuggestions,
    subcategoryFocused,
    vendorSuggestionLoading,
    vendorSuggestions
  };
}
