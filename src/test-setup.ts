import "fake-indexeddb/auto";
import { fakeBrowser } from "wxt/testing";
import { vi, beforeEach, afterEach } from "vitest";

beforeEach(() => {
  fakeBrowser.reset();
});

vi.spyOn(browser.tabs, "sendMessage").mockResolvedValue(undefined);
vi.spyOn(browser.runtime, "getManifest").mockReturnValue({
  version: "0.0.0-test",
  manifest_version: 3,
  name: "OpenMyHealth Test",
} as chrome.runtime.Manifest);

afterEach(() => {
  vi.restoreAllMocks();
});
