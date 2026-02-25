import type { ApprovalPreview, AppState, SearchCandidate } from "../shared/types";

export interface UIState {
  appState: AppState | null;
  candidates: SearchCandidate[];
  selectedIds: Set<string>;
  previewQuery: string;
  preview: ApprovalPreview | null;
}

export function createInitialUIState(): UIState {
  return {
    appState: null,
    candidates: [],
    selectedIds: new Set(),
    previewQuery: "",
    preview: null,
  };
}
