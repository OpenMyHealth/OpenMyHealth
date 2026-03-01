import type { PendingApproval } from "./state";
import { INTEGRATION_WARNING_MESSAGE } from "./state";

const findProviderTabMock = vi.fn();
vi.mock("./tab-manager", () => ({
  findProviderTab: (...args: unknown[]) => findProviderTabMock(...args),
}));

const getSettingsMock = vi.fn();
const updateSettingsMock = vi.fn();
vi.mock("./settings", () => ({
  getSettings: (...args: unknown[]) => getSettingsMock(...args),
  updateSettings: (...args: unknown[]) => updateSettingsMock(...args),
}));

import { sendOverlay, markIntegrationWarning, isOverlayResponsiveForRequest } from "./overlay";

beforeEach(() => {
  findProviderTabMock.mockReset();
  getSettingsMock.mockReset();
  updateSettingsMock.mockReset();
});

describe("overlay", () => {
  describe("sendOverlay", () => {
    it("sends message to active tab and returns sent: true", async () => {
      const tab = { id: 42 } as chrome.tabs.Tab;
      findProviderTabMock.mockResolvedValue(tab);
      vi.spyOn(browser.tabs, "sendMessage").mockResolvedValue(undefined);

      const event = { type: "overlay:ping" as const };
      const result = await sendOverlay("chatgpt", event);
      expect(result).toEqual({ sent: true, tabId: 42 });
    });

    it("returns sent: false with null tabId when no tab found", async () => {
      findProviderTabMock.mockResolvedValue(null);

      const event = { type: "overlay:ping" as const };
      const result = await sendOverlay("chatgpt", event);
      expect(result).toEqual({ sent: false, tabId: null });
    });

    it("returns sent: false with tabId when sendMessage throws", async () => {
      const tab = { id: 7 } as chrome.tabs.Tab;
      findProviderTabMock.mockResolvedValue(tab);
      vi.spyOn(browser.tabs, "sendMessage").mockRejectedValue(new Error("disconnected"));

      const event = { type: "overlay:ping" as const };
      const result = await sendOverlay("chatgpt", event);
      expect(result).toEqual({ sent: false, tabId: 7 });
    });

    it("uses preferred tab via targetTabId", async () => {
      const tab = { id: 99 } as chrome.tabs.Tab;
      findProviderTabMock.mockResolvedValue(tab);
      vi.spyOn(browser.tabs, "sendMessage").mockResolvedValue(undefined);

      const event = { type: "overlay:ping" as const };
      await sendOverlay("claude", event, 99);
      expect(findProviderTabMock).toHaveBeenCalledWith("claude", 99);
    });

    it("passes event to tabs.sendMessage", async () => {
      const tab = { id: 5 } as chrome.tabs.Tab;
      findProviderTabMock.mockResolvedValue(tab);
      const sendSpy = vi.spyOn(browser.tabs, "sendMessage").mockResolvedValue(undefined);

      const event = { type: "overlay:ping" as const };
      await sendOverlay("chatgpt", event);
      expect(sendSpy).toHaveBeenCalledWith(5, event);
    });
  });

  describe("markIntegrationWarning", () => {
    it("sets warning if not already set", async () => {
      const settings = {
        locale: "ko-KR",
        schemaVersion: 1,
        pinConfig: null,
        lockout: { failedAttempts: 0, lockUntil: null },
        connectedProvider: null,
        alwaysAllowScopes: [],
        integrationWarning: null,
      };
      getSettingsMock.mockResolvedValue(settings);
      updateSettingsMock.mockImplementation(async (mutator: (s: typeof settings) => void) => {
        mutator(settings);
        return settings;
      });

      await markIntegrationWarning();
      expect(updateSettingsMock).toHaveBeenCalledOnce();
      expect(settings.integrationWarning).toBe(INTEGRATION_WARNING_MESSAGE);
    });

    it("is idempotent when warning already matches", async () => {
      const settings = {
        locale: "ko-KR",
        schemaVersion: 1,
        pinConfig: null,
        lockout: { failedAttempts: 0, lockUntil: null },
        connectedProvider: null,
        alwaysAllowScopes: [],
        integrationWarning: INTEGRATION_WARNING_MESSAGE,
      };
      getSettingsMock.mockResolvedValue(settings);

      await markIntegrationWarning();
      expect(updateSettingsMock).not.toHaveBeenCalled();
    });
  });

  describe("isOverlayResponsiveForRequest", () => {
    function makePending(overrides: Partial<PendingApproval> = {}): PendingApproval {
      return {
        request: {
          provider: "chatgpt",
          id: "r1",
          resourceTypes: [],
          depth: "summary",
          aiDescription: "",
          extensionSummary: "",
          createdAt: "",
          deadlineAt: 0,
        },
        allowAlways: false,
        timerId: null,
        renderWatchdogId: null,
        renderWatchdogChecks: 0,
        overlayRendered: false,
        resolve: () => {},
        settled: false,
        sourceTabId: null,
        ...overrides,
      };
    }

    it("returns false with no sourceTabId", async () => {
      const result = await isOverlayResponsiveForRequest(makePending());
      expect(result).toBe(false);
    });

    it("returns true when ping succeeds", async () => {
      const tab = { id: 10 } as chrome.tabs.Tab;
      findProviderTabMock.mockResolvedValue(tab);
      vi.spyOn(browser.tabs, "sendMessage").mockResolvedValue(undefined);

      const result = await isOverlayResponsiveForRequest(
        makePending({ sourceTabId: 10 }),
      );
      expect(result).toBe(true);
    });

    it("returns false when ping fails", async () => {
      findProviderTabMock.mockResolvedValue(null);

      const result = await isOverlayResponsiveForRequest(
        makePending({ sourceTabId: 10 }),
      );
      expect(result).toBe(false);
    });
  });
});
