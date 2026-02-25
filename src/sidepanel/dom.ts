export interface SidepanelElements {
  statusBadge: HTMLSpanElement;
  toast: HTMLDivElement;
  authTitle: HTMLHeadingElement;
  authHint: HTMLParagraphElement;
  passphraseInput: HTMLInputElement;
  passphraseConfirmInput: HTMLInputElement;
  authActionButton: HTMLButtonElement;
  lockButton: HTMLButtonElement;

  sourceList: HTMLDivElement;
  sourceStatusWrap: HTMLDivElement;
  sourceStatusTitle: HTMLHeadingElement;
  sourceStepList: HTMLUListElement;
  sourceEstimate: HTMLParagraphElement;
  captureSourceButton: HTMLButtonElement;

  manualTitleInput: HTMLInputElement;
  manualSummaryInput: HTMLTextAreaElement;
  manualDateInput: HTMLInputElement;
  manualTagsInput: HTMLInputElement;
  manualSaveButton: HTMLButtonElement;

  queryInput: HTMLTextAreaElement;
  searchButton: HTMLButtonElement;
  candidateList: HTMLDivElement;
  buildPreviewButton: HTMLButtonElement;

  previewTextarea: HTMLTextAreaElement;
  insertButton: HTMLButtonElement;

  recordsList: HTMLDivElement;
  refreshRecordsButton: HTMLButtonElement;
  transferList: HTMLDivElement;
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`sidepanel element not found: #${id}`);
  }
  return node as T;
}

export function getSidepanelElements(): SidepanelElements {
  return {
    statusBadge: requiredElement<HTMLSpanElement>("statusBadge"),
    toast: requiredElement<HTMLDivElement>("toast"),
    authTitle: requiredElement<HTMLHeadingElement>("authTitle"),
    authHint: requiredElement<HTMLParagraphElement>("authHint"),
    passphraseInput: requiredElement<HTMLInputElement>("passphraseInput"),
    passphraseConfirmInput: requiredElement<HTMLInputElement>("passphraseConfirmInput"),
    authActionButton: requiredElement<HTMLButtonElement>("authActionButton"),
    lockButton: requiredElement<HTMLButtonElement>("lockButton"),

    sourceList: requiredElement<HTMLDivElement>("sourceList"),
    sourceStatusWrap: requiredElement<HTMLDivElement>("sourceStatusWrap"),
    sourceStatusTitle: requiredElement<HTMLHeadingElement>("sourceStatusTitle"),
    sourceStepList: requiredElement<HTMLUListElement>("sourceStepList"),
    sourceEstimate: requiredElement<HTMLParagraphElement>("sourceEstimate"),
    captureSourceButton: requiredElement<HTMLButtonElement>("captureSourceButton"),

    manualTitleInput: requiredElement<HTMLInputElement>("manualTitleInput"),
    manualSummaryInput: requiredElement<HTMLTextAreaElement>("manualSummaryInput"),
    manualDateInput: requiredElement<HTMLInputElement>("manualDateInput"),
    manualTagsInput: requiredElement<HTMLInputElement>("manualTagsInput"),
    manualSaveButton: requiredElement<HTMLButtonElement>("manualSaveButton"),

    queryInput: requiredElement<HTMLTextAreaElement>("queryInput"),
    searchButton: requiredElement<HTMLButtonElement>("searchButton"),
    candidateList: requiredElement<HTMLDivElement>("candidateList"),
    buildPreviewButton: requiredElement<HTMLButtonElement>("buildPreviewButton"),

    previewTextarea: requiredElement<HTMLTextAreaElement>("previewTextarea"),
    insertButton: requiredElement<HTMLButtonElement>("insertButton"),

    recordsList: requiredElement<HTMLDivElement>("recordsList"),
    refreshRecordsButton: requiredElement<HTMLButtonElement>("refreshRecordsButton"),
    transferList: requiredElement<HTMLDivElement>("transferList"),
  };
}
