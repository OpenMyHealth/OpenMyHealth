import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import type { McpApprovalRequest } from "../core/models";
import type { ResourceType } from "../../packages/contracts/src/index";
import {
  isStaleRequestError,
  stageColor,
  stageGuide,
  defaultSelectedItemIds,
  getFocusableElements,
  retryLabel,
  filterSelectedItems,
} from "./overlay-utils";

describe("stageColor", () => {
  it("returns 'red' at 0ms", () => {
    expect(stageColor(0)).toBe("red");
  });

  it("returns 'red' at 5000ms", () => {
    expect(stageColor(5000)).toBe("red");
  });

  it("returns 'amber' at 5001ms", () => {
    expect(stageColor(5001)).toBe("amber");
  });

  it("returns 'amber' at 15000ms", () => {
    expect(stageColor(15000)).toBe("amber");
  });

  it("returns 'blue' at 15001ms", () => {
    expect(stageColor(15001)).toBe("blue");
  });

  it("returns 'blue' at 30000ms", () => {
    expect(stageColor(30000)).toBe("blue");
  });
});

describe("stageGuide", () => {
  it("returns urgent message at 0ms", () => {
    expect(stageGuide(0)).toBe("5초 후 자동 거절됩니다. 지금 전송 또는 거절을 선택해 주세요.");
  });

  it("returns urgent message at 5000ms", () => {
    expect(stageGuide(5000)).toBe("5초 후 자동 거절됩니다. 지금 전송 또는 거절을 선택해 주세요.");
  });

  it("returns review message at 5001ms", () => {
    expect(stageGuide(5001)).toBe("보낼 항목을 확인한 뒤 전송 또는 거절을 선택해 주세요.");
  });

  it("returns review message at 15000ms", () => {
    expect(stageGuide(15000)).toBe("보낼 항목을 확인한 뒤 전송 또는 거절을 선택해 주세요.");
  });

  it("returns default message at 15001ms", () => {
    expect(stageGuide(15001)).toBe("아래 공유 항목을 확인해 주세요.");
  });

  it("returns default message at 60000ms", () => {
    expect(stageGuide(60000)).toBe("아래 공유 항목을 확인해 주세요.");
  });
});

describe("isStaleRequestError", () => {
  it("returns true for Korean stale message", () => {
    expect(isStaleRequestError("이미 처리되었거나 찾을 수 없습니다")).toBe(true);
  });

  it("returns true for English stale message", () => {
    expect(isStaleRequestError("request not found")).toBe(true);
  });

  it("returns true when message contains the stale substring", () => {
    expect(isStaleRequestError("Error: request not found in queue")).toBe(true);
  });

  it("returns false for unrelated message", () => {
    expect(isStaleRequestError("timeout occurred")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isStaleRequestError(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isStaleRequestError("")).toBe(false);
  });
});

describe("defaultSelectedItemIds", () => {
  it("returns empty array when resourceOptions is undefined", () => {
    const request = { resourceOptions: undefined } as McpApprovalRequest;
    expect(defaultSelectedItemIds(request)).toEqual([]);
  });

  it("returns empty array when resourceOptions is empty", () => {
    const request = { resourceOptions: [] } as unknown as McpApprovalRequest;
    expect(defaultSelectedItemIds(request)).toEqual([]);
  });

  it("returns all item ids from single option", () => {
    const request = {
      resourceOptions: [
        {
          resourceType: "Observation",
          count: 2,
          items: [
            { id: "a", label: "A" },
            { id: "b", label: "B" },
          ],
        },
      ],
    } as McpApprovalRequest;
    expect(defaultSelectedItemIds(request)).toEqual(["a", "b"]);
  });

  it("flattens item ids from multiple options", () => {
    const request = {
      resourceOptions: [
        {
          resourceType: "Observation",
          count: 1,
          items: [{ id: "x", label: "X" }],
        },
        {
          resourceType: "Condition",
          count: 1,
          items: [{ id: "y", label: "Y" }],
        },
      ],
    } as McpApprovalRequest;
    expect(defaultSelectedItemIds(request)).toEqual(["x", "y"]);
  });
});

describe("getFocusableElements", () => {
  function createDOM(html: string): HTMLElement {
    const dom = new JSDOM(`<div id="root">${html}</div>`);
    return dom.window.document.getElementById("root") as HTMLElement;
  }

  it("returns buttons", () => {
    const root = createDOM('<button>Click</button>');
    const result = getFocusableElements(root);
    expect(result).toHaveLength(1);
    expect(result[0].tagName).toBe("BUTTON");
  });

  it("returns inputs", () => {
    const root = createDOM('<input type="text" />');
    const result = getFocusableElements(root);
    expect(result).toHaveLength(1);
    expect(result[0].tagName).toBe("INPUT");
  });

  it("excludes disabled elements", () => {
    const root = createDOM('<button disabled>Click</button>');
    expect(getFocusableElements(root)).toHaveLength(0);
  });

  it("excludes aria-hidden elements", () => {
    const root = createDOM('<button aria-hidden="true">Click</button>');
    expect(getFocusableElements(root)).toHaveLength(0);
  });

  it("includes tabindex elements", () => {
    const root = createDOM('<div tabindex="0">focusable</div>');
    const result = getFocusableElements(root);
    expect(result).toHaveLength(1);
  });

  it("excludes tabindex -1 elements", () => {
    const root = createDOM('<div tabindex="-1">not focusable</div>');
    expect(getFocusableElements(root)).toHaveLength(0);
  });

  it("returns empty array for empty root", () => {
    const root = createDOM('');
    expect(getFocusableElements(root)).toEqual([]);
  });
});

describe("retryLabel", () => {
  it("returns correct label for 'approve'", () => {
    expect(retryLabel("approve")).toBe("보내기 다시 시도");
  });

  it("returns correct label for 'deny'", () => {
    expect(retryLabel("deny")).toBe("거절 다시 시도");
  });

  it("returns correct label for 'open-vault'", () => {
    expect(retryLabel("open-vault")).toBe("보관함 다시 열기");
  });

  it("returns generic label for null", () => {
    expect(retryLabel(null)).toBe("다시 시도");
  });
});

describe("filterSelectedItems", () => {
  it("returns items matching selected resource types", () => {
    const selected: ResourceType[] = ["Observation"];
    const selectedItemIds = ["a", "b"];
    const itemTypeMap = new Map<string, ResourceType>([
      ["a", "Observation"],
      ["b", "Condition"],
    ]);
    expect(filterSelectedItems(selected, selectedItemIds, itemTypeMap)).toEqual(["a"]);
  });

  it("deduplicates item ids", () => {
    const selected: ResourceType[] = ["Observation"];
    const selectedItemIds = ["a", "a", "a"];
    const itemTypeMap = new Map<string, ResourceType>([["a", "Observation"]]);
    expect(filterSelectedItems(selected, selectedItemIds, itemTypeMap)).toEqual(["a"]);
  });

  it("returns empty when no types match", () => {
    const selected: ResourceType[] = ["Condition"];
    const selectedItemIds = ["a"];
    const itemTypeMap = new Map<string, ResourceType>([["a", "Observation"]]);
    expect(filterSelectedItems(selected, selectedItemIds, itemTypeMap)).toEqual([]);
  });

  it("returns empty when itemTypeMap has no entry for id", () => {
    const selected: ResourceType[] = ["Observation"];
    const selectedItemIds = ["missing"];
    const itemTypeMap = new Map<string, ResourceType>();
    expect(filterSelectedItems(selected, selectedItemIds, itemTypeMap)).toEqual([]);
  });

  it("returns empty for empty inputs", () => {
    expect(filterSelectedItems([], [], new Map())).toEqual([]);
  });
});
