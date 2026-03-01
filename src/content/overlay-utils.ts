import type { ResourceType } from "../../packages/contracts/src/index";
import type { McpApprovalRequest } from "../core/models";

export function isStaleRequestError(message?: string): boolean {
  return Boolean(message && (message.includes("이미 처리되었거나 찾을 수 없습니다") || message.includes("request not found")));
}

export function stageColor(remainingMs: number): "blue" | "amber" | "red" {
  if (remainingMs <= 5_000) {
    return "red";
  }
  if (remainingMs <= 15_000) {
    return "amber";
  }
  return "blue";
}

export function stageGuide(remainingMs: number): string {
  if (remainingMs <= 5_000) {
    return "5초 후 자동 거절됩니다. 지금 전송 또는 거절을 선택해 주세요.";
  }
  if (remainingMs <= 15_000) {
    return "보낼 항목을 확인한 뒤 전송 또는 거절을 선택해 주세요.";
  }
  return "아래 공유 항목을 확인해 주세요.";
}

export function defaultSelectedItemIds(request: McpApprovalRequest): string[] {
  if (!request.resourceOptions || request.resourceOptions.length === 0) {
    return [];
  }
  return request.resourceOptions.flatMap((option) => option.items.map((item) => item.id));
}

export function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");
}

export function retryLabel(action: "open-vault" | "approve" | "deny" | null): string {
  if (action === "approve") {
    return "보내기 다시 시도";
  }
  if (action === "deny") {
    return "거절 다시 시도";
  }
  if (action === "open-vault") {
    return "보관함 다시 열기";
  }
  return "다시 시도";
}

export function filterSelectedItems(
  selected: ResourceType[],
  selectedItemIds: string[],
  itemTypeMap: Map<string, ResourceType>,
): string[] {
  return selectedItemIds.filter((itemId, index, array) => {
    const resourceType = itemTypeMap.get(itemId);
    return Boolean(resourceType && selected.includes(resourceType) && array.indexOf(itemId) === index);
  });
}
