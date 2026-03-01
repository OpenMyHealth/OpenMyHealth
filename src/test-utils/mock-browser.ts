import { vi } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMockFn = (...args: any[]) => any;

const TAB_DEFAULTS: chrome.tabs.Tab = {
  index: 0,
  active: true,
  pinned: false,
  highlighted: false,
  incognito: false,
  selected: false,
  windowId: 1,
  discarded: false,
  autoDiscardable: true,
  groupId: -1,
  frozen: false,
};

export function mockTabsGet(tab: Partial<chrome.tabs.Tab> & { id: number }) {
  const fullTab: chrome.tabs.Tab = { ...TAB_DEFAULTS, ...tab };
  (vi.spyOn(browser.tabs, "get") as unknown as ReturnType<typeof vi.fn<AnyMockFn>>).mockResolvedValue(fullTab);
  return fullTab;
}

export function mockTabsQuery(tabs: Array<Partial<chrome.tabs.Tab> & { id: number }>) {
  const fullTabs: chrome.tabs.Tab[] = tabs.map((tab) => ({
    ...TAB_DEFAULTS,
    active: false,
    ...tab,
  }));
  (vi.spyOn(browser.tabs, "query") as unknown as ReturnType<typeof vi.fn<AnyMockFn>>).mockResolvedValue(fullTabs);
  return fullTabs;
}

export function mockTabsCreate() {
  return (vi.spyOn(browser.tabs, "create") as unknown as ReturnType<typeof vi.fn<AnyMockFn>>).mockResolvedValue({
    ...TAB_DEFAULTS,
    id: 999,
  });
}

export function mockTabsUpdate() {
  return (vi.spyOn(browser.tabs, "update") as unknown as ReturnType<typeof vi.fn<AnyMockFn>>).mockResolvedValue({
    ...TAB_DEFAULTS,
    id: 1,
  });
}
