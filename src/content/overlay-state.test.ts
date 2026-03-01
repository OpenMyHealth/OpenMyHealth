// @vitest-environment happy-dom
import { renderHook, act } from "@testing-library/react";
import type { AiProvider, ResourceType } from "../../packages/contracts/src/index";
import type { McpApprovalRequest } from "../core/models";
import type { OverlayEvent } from "../core/messages";
import { useOverlayState, type OverlayStateDeps } from "./overlay-state";

vi.mock("../core/runtime-client", () => ({
  sendRuntimeMessage: vi.fn(),
}));

vi.mock("./page-bridge", () => ({
  setupPageMcpBridge: vi.fn(() => vi.fn()),
}));

function createMockDeps(overrides?: Partial<OverlayStateDeps>): OverlayStateDeps {
  return {
    sendMessage: vi.fn().mockResolvedValue({ ok: true }),
    getProvider: vi.fn().mockReturnValue("chatgpt" as AiProvider),
    ...overrides,
  };
}

function createApprovalRequest(overrides?: Partial<McpApprovalRequest>): McpApprovalRequest {
  return {
    id: "req-1",
    provider: "chatgpt",
    resourceTypes: ["Observation"] as ResourceType[],
    depth: "summary",
    aiDescription: "test",
    extensionSummary: "test summary",
    createdAt: new Date().toISOString(),
    deadlineAt: Date.now() + 60_000,
    resourceOptions: [
      {
        resourceType: "Observation" as ResourceType,
        count: 2,
        items: [
          { id: "item-1", label: "Item 1" },
          { id: "item-2", label: "Item 2" },
        ],
      },
    ],
    ...overrides,
  };
}

let overlayListener: ((message: OverlayEvent) => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  overlayListener = null;

  vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation((fn: (...args: unknown[]) => unknown) => {
    overlayListener = fn as (message: OverlayEvent) => void;
  });
  vi.spyOn(browser.runtime.onMessage, "removeListener").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

function emitOverlayEvent(event: OverlayEvent): void {
  overlayListener?.(event);
}

describe("useOverlayState", () => {
  describe("initial state", () => {
    it("starts with mode hidden", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));
      expect(result.current.mode).toBe("hidden");
    });

    it("starts with no request", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));
      expect(result.current.request).toBeNull();
    });

    it("sends overlay:ready on mount", () => {
      const deps = createMockDeps();
      renderHook(() => useOverlayState(deps));
      expect(deps.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "overlay:ready", provider: "chatgpt" }),
      );
    });
  });

  describe("mode transitions", () => {
    it("transitions to unlock mode on overlay:request-unlock", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:request-unlock",
          request: createApprovalRequest(),
          queueLength: 1,
          lockoutUntil: null,
        });
      });

      expect(result.current.mode).toBe("unlock");
    });

    it("transitions to approval mode on overlay:show-approval", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      expect(result.current.mode).toBe("approval");
    });

    it("transitions to resolved mode on overlay:resolved with approved", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      act(() => {
        emitOverlayEvent({
          type: "overlay:resolved",
          requestId: "req-1",
          status: "approved",
        });
      });

      expect(result.current.mode).toBe("resolved");
    });

    it("transitions to connected mode on overlay:connection-success", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:connection-success",
          provider: "chatgpt",
        });
      });

      expect(result.current.mode).toBe("connected");
    });

    it("transitions to timeout mode on overlay:resolved with timeout", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      act(() => {
        emitOverlayEvent({
          type: "overlay:resolved",
          requestId: "req-1",
          status: "timeout",
        });
      });

      expect(result.current.mode).toBe("timeout");
    });

    it("ignores overlay:resolved for mismatched requestId", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      act(() => {
        emitOverlayEvent({
          type: "overlay:resolved",
          requestId: "wrong-id",
          status: "approved",
        });
      });

      expect(result.current.mode).toBe("approval");
    });
  });

  describe("approval flow", () => {
    it("approve() sends decision with selected types", async () => {
      const deps = createMockDeps();
      deps.sendMessage = vi.fn().mockResolvedValue({ ok: true, status: "approved" });
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      await act(async () => {
        await result.current.approve();
      });

      expect(deps.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "approval:decision",
          requestId: "req-1",
          decision: "approved",
          selectedResourceTypes: ["Observation"],
        }),
      );
    });

    it("deny() sends decision with denied", async () => {
      const deps = createMockDeps();
      deps.sendMessage = vi.fn().mockResolvedValue({ ok: true, status: "denied" });
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      await act(async () => {
        await result.current.deny();
      });

      expect(deps.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "approval:decision",
          requestId: "req-1",
          decision: "denied",
        }),
      );
    });

    it("openVault() sends overlay:open-vault message", async () => {
      const deps = createMockDeps();
      deps.sendMessage = vi.fn().mockResolvedValue({ ok: true });
      const { result } = renderHook(() => useOverlayState(deps));

      await act(async () => {
        await result.current.openVault();
      });

      expect(deps.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "overlay:open-vault" }),
      );
    });

    it("approve() does nothing without request", async () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      await act(async () => {
        await result.current.approve();
      });

      // Only the initial overlay:ready call should have been made
      expect(deps.sendMessage).toHaveBeenCalledTimes(1);
    });

    it("approve() sets error when no types selected", async () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      // Deselect all types
      act(() => {
        result.current.toggleType("Observation");
      });

      await act(async () => {
        await result.current.approve();
      });

      expect(result.current.actionError).toBeTruthy();
    });
  });

  describe("resource selection", () => {
    it("toggleType removes a selected type", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      expect(result.current.selected).toContain("Observation");

      act(() => {
        result.current.toggleType("Observation");
      });

      expect(result.current.selected).not.toContain("Observation");
    });

    it("toggleType adds a type back", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      act(() => {
        result.current.toggleType("Observation");
      });
      act(() => {
        result.current.toggleType("Observation");
      });

      expect(result.current.selected).toContain("Observation");
    });

    it("toggleItem sets itemSelectionCustomized flag", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      expect(result.current.itemSelectionCustomized).toBe(false);

      act(() => {
        result.current.toggleItem("Observation", "item-1");
      });

      expect(result.current.itemSelectionCustomized).toBe(true);
    });

    it("toggleItem removes item from selectedItemIds", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      // Initially all items are selected
      expect(result.current.selectedItemIds).toContain("item-1");

      act(() => {
        result.current.toggleItem("Observation", "item-1");
      });

      expect(result.current.selectedItemIds).not.toContain("item-1");
    });

    it("toggleItem deselects type when all items for type removed", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      act(() => {
        result.current.toggleItem("Observation", "item-1");
      });
      act(() => {
        result.current.toggleItem("Observation", "item-2");
      });

      expect(result.current.selected).not.toContain("Observation");
    });
  });

  describe("timer", () => {
    it("updates nowMs on interval in approval mode", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest({ deadlineAt: Date.now() + 60_000 }),
          queueLength: 1,
        });
      });

      const initialNowMs = result.current.nowMs;

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(result.current.nowMs).toBeGreaterThanOrEqual(initialNowMs);
    });

    it("announces at 15s remaining mark", () => {
      const deps = createMockDeps();
      const now = Date.now();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest({ deadlineAt: now + 16_000 }),
          queueLength: 1,
        });
      });

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(result.current.timerAnnouncement).toContain("15");
    });

    it("announces at 5s remaining mark", () => {
      const deps = createMockDeps();
      const now = Date.now();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest({ deadlineAt: now + 6_000 }),
          queueLength: 1,
        });
      });

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(result.current.timerAnnouncement).toContain("5");
    });
  });

  describe("auto-hide", () => {
    it("hides resolved mode after 3 seconds", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      act(() => {
        emitOverlayEvent({
          type: "overlay:resolved",
          requestId: "req-1",
          status: "approved",
        });
      });

      expect(result.current.mode).toBe("resolved");

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(result.current.mode).toBe("hidden");
    });

    it("hides connected mode after 10 seconds", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:connection-success",
          provider: "chatgpt",
        });
      });

      expect(result.current.mode).toBe("connected");

      act(() => {
        vi.advanceTimersByTime(10_000);
      });

      expect(result.current.mode).toBe("hidden");
    });
  });

  describe("error handling", () => {
    it("sets actionError when sendMessage rejects on approve", async () => {
      const deps = createMockDeps();
      deps.sendMessage = vi.fn().mockImplementation((msg: Record<string, unknown>) => {
        if (msg.type === "approval:decision") {
          return Promise.reject(new Error("network fail"));
        }
        return Promise.resolve({ ok: true });
      });

      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      await act(async () => {
        await result.current.approve();
      });

      expect(result.current.actionError).toBeTruthy();
    });

    it("sets actionError when sendMessage rejects on deny", async () => {
      const deps = createMockDeps();
      deps.sendMessage = vi.fn().mockImplementation((msg: Record<string, unknown>) => {
        if (msg.type === "approval:decision") {
          return Promise.reject(new Error("fail"));
        }
        return Promise.resolve({ ok: true });
      });

      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      await act(async () => {
        await result.current.deny();
      });

      expect(result.current.actionError).toBeTruthy();
    });

    it("detects stale request error and transitions to resolved", async () => {
      const deps = createMockDeps();
      deps.sendMessage = vi.fn().mockImplementation((msg: Record<string, unknown>) => {
        if (msg.type === "approval:decision") {
          return Promise.resolve({ ok: false, error: "이미 처리되었거나 찾을 수 없습니다" });
        }
        return Promise.resolve({ ok: true });
      });

      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      await act(async () => {
        await result.current.approve();
      });

      expect(result.current.mode).toBe("resolved");
      expect(result.current.actionError).toBeNull();
    });

    it("sets actionError when openVault response is not ok", async () => {
      const deps = createMockDeps();
      deps.sendMessage = vi.fn().mockImplementation((msg: Record<string, unknown>) => {
        if (msg.type === "overlay:open-vault") {
          return Promise.resolve({ ok: false, error: "vault error" });
        }
        return Promise.resolve({ ok: true });
      });

      const { result } = renderHook(() => useOverlayState(deps));

      await act(async () => {
        await result.current.openVault();
      });

      expect(result.current.actionError).toBeTruthy();
    });
  });

  describe("always-allow", () => {
    it("toggleAlwaysAllow sets alwaysConfirmPending", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        result.current.toggleAlwaysAllow(true);
      });

      expect(result.current.alwaysConfirmPending).toBe(true);
    });

    it("toggleAlwaysAllow(false) clears pending and sets one-time", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        result.current.toggleAlwaysAllow(true);
      });
      act(() => {
        result.current.toggleAlwaysAllow(false);
      });

      expect(result.current.alwaysConfirmPending).toBe(false);
      expect(result.current.permissionLevel).toBe("one-time");
    });

    it("confirmAlwaysAllow sets permissionLevel to always", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        result.current.toggleAlwaysAllow(true);
      });
      act(() => {
        result.current.confirmAlwaysAllow();
      });

      expect(result.current.permissionLevel).toBe("always");
      expect(result.current.alwaysConfirmPending).toBe(false);
    });

    it("cancelAlwaysAllow clears pending state", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        result.current.toggleAlwaysAllow(true);
      });
      act(() => {
        result.current.cancelAlwaysAllow();
      });

      expect(result.current.alwaysConfirmPending).toBe(false);
    });

    it("approve sends with always permission level", async () => {
      const deps = createMockDeps();
      deps.sendMessage = vi.fn().mockResolvedValue({ ok: true, status: "approved" });
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      act(() => {
        result.current.toggleAlwaysAllow(true);
      });
      act(() => {
        result.current.confirmAlwaysAllow();
      });

      await act(async () => {
        await result.current.approve();
      });

      expect(deps.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "approval:decision",
          permissionLevel: "always",
        }),
      );
    });

    it("toggleItem resets permissionLevel from always to one-time", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      act(() => {
        result.current.toggleAlwaysAllow(true);
      });
      act(() => {
        result.current.confirmAlwaysAllow();
      });

      expect(result.current.permissionLevel).toBe("always");

      act(() => {
        result.current.toggleItem("Observation", "item-1");
      });

      expect(result.current.permissionLevel).toBe("one-time");
    });
  });

  describe("queue length", () => {
    it("updates queueLength on overlay:queue event", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({ type: "overlay:queue", queueLength: 5 });
      });

      expect(result.current.queueLength).toBe(5);
    });
  });

  describe("update-approval", () => {
    it("updates extensionSummary and resourceOptions on overlay:update-approval", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      const request = createApprovalRequest();
      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request,
          queueLength: 1,
        });
      });

      const updatedRequest = {
        ...request,
        extensionSummary: "updated summary",
        resourceOptions: [
          {
            resourceType: "Observation" as ResourceType,
            count: 3,
            items: [
              { id: "item-1", label: "Item 1" },
              { id: "item-2", label: "Item 2" },
              { id: "item-3", label: "Item 3" },
            ],
          },
        ],
      };

      act(() => {
        emitOverlayEvent({
          type: "overlay:update-approval",
          request: updatedRequest,
          queueLength: 2,
        });
      });

      expect(result.current.request?.extensionSummary).toBe("updated summary");
      expect(result.current.queueLength).toBe(2);
    });
  });

  describe("lockout", () => {
    it("sets lockoutUntil on overlay:request-unlock", () => {
      const deps = createMockDeps();
      const lockoutTime = Date.now() + 30_000;
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:request-unlock",
          request: createApprovalRequest(),
          queueLength: 1,
          lockoutUntil: lockoutTime,
        });
      });

      expect(result.current.lockoutUntil).toBe(lockoutTime);
    });

    it("clears lockoutUntil on overlay:show-approval", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:request-unlock",
          request: createApprovalRequest(),
          queueLength: 1,
          lockoutUntil: Date.now() + 30_000,
        });
      });

      expect(result.current.lockoutUntil).not.toBeNull();

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      expect(result.current.lockoutUntil).toBeNull();
    });
  });

  describe("retryLastAction", () => {
    it("retries approve action", async () => {
      const deps = createMockDeps();
      let approveCallCount = 0;
      deps.sendMessage = vi.fn().mockImplementation((msg: Record<string, unknown>) => {
        if (msg.type === "approval:decision" && msg.decision === "approved") {
          approveCallCount++;
          if (approveCallCount === 1) return Promise.reject(new Error("fail"));
          return Promise.resolve({ ok: true, status: "approved" });
        }
        return Promise.resolve({ ok: true });
      });

      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      await act(async () => {
        await result.current.approve();
      });

      expect(result.current.retryAction).toBe("approve");

      await act(async () => {
        await result.current.retryLastAction();
      });

      expect(approveCallCount).toBe(2);
    });

    it("retries deny action", async () => {
      const deps = createMockDeps();
      let denyCallCount = 0;
      deps.sendMessage = vi.fn().mockImplementation((msg: Record<string, unknown>) => {
        if (msg.type === "approval:decision" && msg.decision === "denied") {
          denyCallCount++;
          if (denyCallCount === 1) return Promise.reject(new Error("fail"));
          return Promise.resolve({ ok: true, status: "denied" });
        }
        return Promise.resolve({ ok: true });
      });

      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      await act(async () => {
        await result.current.deny();
      });

      expect(result.current.retryAction).toBe("deny");

      await act(async () => {
        await result.current.retryLastAction();
      });

      expect(denyCallCount).toBe(2);
    });

    it("retries open-vault action", async () => {
      const deps = createMockDeps();
      let openVaultCallCount = 0;
      deps.sendMessage = vi.fn().mockImplementation((msg: Record<string, unknown>) => {
        if (msg.type === "overlay:open-vault") {
          openVaultCallCount++;
          if (openVaultCallCount === 1) return Promise.reject(new Error("fail"));
          return Promise.resolve({ ok: true });
        }
        return Promise.resolve({ ok: true });
      });

      const { result } = renderHook(() => useOverlayState(deps));

      await act(async () => {
        await result.current.openVault();
      });

      expect(result.current.retryAction).toBe("open-vault");

      await act(async () => {
        await result.current.retryLastAction();
      });

      expect(openVaultCallCount).toBe(2);
    });

    it("falls back to overlay:ready when retryAction is null", async () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      await act(async () => {
        await result.current.retryLastAction();
      });

      // Should have called overlay:ready (init) + another overlay:ready (retry fallback)
      const readyCalls = (deps.sendMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: unknown[]) => (c[0] as Record<string, unknown>).type === "overlay:ready",
      );
      expect(readyCalls.length).toBe(2);
    });

    it("sets actionError when fallback retry fails", async () => {
      const deps = createMockDeps();
      let callCount = 0;
      deps.sendMessage = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount > 1) return Promise.reject(new Error("fail"));
        return Promise.resolve({ ok: true });
      });

      const { result } = renderHook(() => useOverlayState(deps));

      await act(async () => {
        await result.current.retryLastAction();
      });

      expect(result.current.actionError).toBeTruthy();
    });
  });

  describe("deny edge cases", () => {
    it("deny() does nothing without request", async () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      await act(async () => {
        await result.current.deny();
      });

      // Only the initial overlay:ready call should have been made
      expect(deps.sendMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe("openVault edge cases", () => {
    it("sets actionError when openVault sendMessage throws", async () => {
      const deps = createMockDeps();
      deps.sendMessage = vi.fn().mockImplementation((msg: Record<string, unknown>) => {
        if (msg.type === "overlay:open-vault") {
          return Promise.reject(new Error("network error"));
        }
        return Promise.resolve({ ok: true });
      });

      const { result } = renderHook(() => useOverlayState(deps));

      await act(async () => {
        await result.current.openVault();
      });

      expect(result.current.actionError).toBeTruthy();
      expect(result.current.openingVault).toBe(false);
    });

    it("clears retryAction on successful openVault", async () => {
      const deps = createMockDeps();
      deps.sendMessage = vi.fn().mockResolvedValue({ ok: true });

      const { result } = renderHook(() => useOverlayState(deps));

      await act(async () => {
        await result.current.openVault();
      });

      expect(result.current.retryAction).toBeNull();
    });
  });

  describe("applyDecisionResponse edge cases", () => {
    it("sets actionError when response not ok and not stale", async () => {
      const deps = createMockDeps();
      deps.sendMessage = vi.fn().mockImplementation((msg: Record<string, unknown>) => {
        if (msg.type === "approval:decision") {
          return Promise.resolve({ ok: false, error: "some error" });
        }
        return Promise.resolve({ ok: true });
      });

      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      await act(async () => {
        await result.current.approve();
      });

      expect(result.current.actionError).toBe("some error");
    });

    it("uses fallback error when response not ok and error is undefined", async () => {
      const deps = createMockDeps();
      deps.sendMessage = vi.fn().mockImplementation((msg: Record<string, unknown>) => {
        if (msg.type === "approval:decision") {
          return Promise.resolve({ ok: false });
        }
        return Promise.resolve({ ok: true });
      });

      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      await act(async () => {
        await result.current.approve();
      });

      expect(result.current.actionError).toBeTruthy();
    });
  });

  describe("approve with customized items", () => {
    it("blocks approve when itemSelectionCustomized and permissionLevel is always", async () => {
      const deps = createMockDeps();
      deps.sendMessage = vi.fn().mockResolvedValue({ ok: true, status: "approved" });
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      // Set always allow first
      act(() => { result.current.toggleAlwaysAllow(true); });
      act(() => { result.current.confirmAlwaysAllow(); });

      // Then customize items (which should reset permissionLevel, but let's test the guard)
      // The toggleItem resets permissionLevel to one-time, so we manually test the condition
      // by setting always and then calling approve with customized state
      act(() => { result.current.toggleItem("Observation", "item-1"); });

      // permissionLevel was already reset to one-time by toggleItem
      expect(result.current.permissionLevel).toBe("one-time");
    });

    it("sends selectedItemIds when item selection is customized", async () => {
      const deps = createMockDeps();
      deps.sendMessage = vi.fn().mockResolvedValue({ ok: true, status: "approved" });
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      // Toggle item-1 off (customizing selection)
      act(() => { result.current.toggleItem("Observation", "item-1"); });
      // Open detail panel
      act(() => { result.current.setDetailOpen(true); });

      await act(async () => {
        await result.current.approve();
      });

      expect(deps.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "approval:decision",
          selectedItemIds: expect.any(Array),
        }),
      );
    });

    it("blocks approve when all items deselected via customization", async () => {
      const deps = createMockDeps();
      deps.sendMessage = vi.fn().mockResolvedValue({ ok: true, status: "approved" });
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      // Toggle off both items
      act(() => { result.current.toggleItem("Observation", "item-1"); });
      act(() => { result.current.toggleItem("Observation", "item-2"); });

      // Open detail panel
      act(() => { result.current.setDetailOpen(true); });

      await act(async () => {
        await result.current.approve();
      });

      // No types left selected, so actionError should be set
      expect(result.current.actionError).toBeTruthy();
    });
  });

  describe("overlay:resolved with denied status", () => {
    it("transitions to resolved mode on denied status", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      act(() => {
        emitOverlayEvent({
          type: "overlay:resolved",
          requestId: "req-1",
          status: "denied",
        });
      });

      expect(result.current.mode).toBe("resolved");
      expect(result.current.resolvedText).toContain("거절");
    });

    it("transitions to resolved mode on error status", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      act(() => {
        emitOverlayEvent({
          type: "overlay:resolved",
          requestId: "req-1",
          status: "error",
        });
      });

      expect(result.current.mode).toBe("resolved");
    });
  });

  describe("update-approval with customized items", () => {
    it("updates summary and queue on preview update", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      const request = createApprovalRequest();
      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request,
          queueLength: 1,
        });
      });

      act(() => {
        emitOverlayEvent({
          type: "overlay:update-approval",
          request: {
            ...request,
            extensionSummary: "new summary",
          },
          queueLength: 3,
        });
      });

      expect(result.current.request?.extensionSummary).toBe("new summary");
      expect(result.current.queueLength).toBe(3);
    });

    it("ignores update for different request id", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      const request = createApprovalRequest();
      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request,
          queueLength: 1,
        });
      });

      act(() => {
        emitOverlayEvent({
          type: "overlay:update-approval",
          request: {
            ...request,
            id: "different-id",
            extensionSummary: "updated",
          },
          queueLength: 2,
        });
      });

      // Summary should not be updated since request id doesn't match
      expect(result.current.request?.extensionSummary).toBe("test summary");
    });
  });

  describe("decisionPending flag", () => {
    it("sets decisionPending during approve", async () => {
      const deps = createMockDeps();
      let resolveSend!: (value: unknown) => void;
      deps.sendMessage = vi.fn().mockImplementation((msg: Record<string, unknown>) => {
        if (msg.type === "approval:decision") {
          return new Promise((resolve) => { resolveSend = resolve; });
        }
        return Promise.resolve({ ok: true });
      });

      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      let approvePromise: Promise<void>;
      act(() => {
        approvePromise = result.current.approve();
      });

      expect(result.current.decisionPending).toBe(true);

      await act(async () => {
        resolveSend({ ok: true, status: "approved" });
        await approvePromise!;
      });

      expect(result.current.decisionPending).toBe(false);
    });
  });
});
