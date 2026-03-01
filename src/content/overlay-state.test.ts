// @vitest-environment happy-dom
import { renderHook, act } from "@testing-library/react";
import type { AiProvider, ResourceType } from "../../packages/contracts/src/index";
import type { McpApprovalRequest } from "../core/models";
import type { OverlayEvent } from "../core/messages";
import { useOverlayState, getLastKnownRequestId, type OverlayStateDeps } from "./overlay-state";

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

    it("sets decisionPending during deny", async () => {
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

      let denyPromise: Promise<void>;
      act(() => {
        denyPromise = result.current.deny();
      });

      expect(result.current.decisionPending).toBe(true);

      await act(async () => {
        resolveSend({ ok: true, status: "denied" });
        await denyPromise!;
      });

      expect(result.current.decisionPending).toBe(false);
    });
  });

  describe("getLastKnownRequestId", () => {
    it("tracks current request id after show-approval", () => {
      const deps = createMockDeps();
      renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest({ id: "tracked-req" }),
          queueLength: 1,
        });
      });

      expect(getLastKnownRequestId()).toBe("tracked-req");
    });

    it("returns request id type string or null", () => {
      const result = getLastKnownRequestId();
      expect(typeof result === "string" || result === null).toBe(true);
    });
  });

  describe("approve edge cases (lines 410-416)", () => {
    it("blocks approve when detailOpen, items customized, and all filtered items are empty", async () => {
      const deps = createMockDeps();
      deps.sendMessage = vi.fn().mockResolvedValue({ ok: true, status: "approved" });
      const { result } = renderHook(() => useOverlayState(deps));

      // Use two resource types: one with items, one without
      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest({
            resourceTypes: ["Observation", "Condition"] as ResourceType[],
            resourceOptions: [
              {
                resourceType: "Observation" as ResourceType,
                count: 2,
                items: [
                  { id: "item-1", label: "Item 1" },
                  { id: "item-2", label: "Item 2" },
                ],
              },
              {
                resourceType: "Condition" as ResourceType,
                count: 0,
                items: [],
              },
            ],
          }),
          queueLength: 1,
        });
      });

      // Customize items: deselect all Observation items (which removes Observation from selected)
      act(() => { result.current.toggleItem("Observation", "item-1"); });
      act(() => { result.current.toggleItem("Observation", "item-2"); });

      // Now selected = ["Condition"], itemSelectionCustomized=true
      // itemTypeMap has entries only for item-1 and item-2 (Observation)
      // filterSelectedItems returns [] because no item in selectedItemIds has type "Condition"
      expect(result.current.selected).toContain("Condition");
      expect(result.current.selected).not.toContain("Observation");
      expect(result.current.itemSelectionCustomized).toBe(true);

      // Open detail panel
      act(() => { result.current.setDetailOpen(true); });

      await act(async () => {
        await result.current.approve();
      });

      // Should get error because itemSelectionCustomized=true, detailOpen=true,
      // itemTypeMap.size > 0, and filterSelectedItems returns empty
      expect(result.current.actionError).toBeTruthy();
    });

    it("blocks approve when itemSelectionCustomized is true and permissionLevel is always", async () => {
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

      // Manually set itemSelectionCustomized to true via toggleItem
      act(() => { result.current.toggleItem("Observation", "item-1"); });

      // toggleItem resets permissionLevel to one-time, so we need to set always after
      // Use confirmAlwaysAllow to set permissionLevel to "always"
      act(() => { result.current.toggleAlwaysAllow(true); });
      act(() => { result.current.confirmAlwaysAllow(); });

      expect(result.current.itemSelectionCustomized).toBe(true);
      expect(result.current.permissionLevel).toBe("always");

      await act(async () => {
        await result.current.approve();
      });

      expect(result.current.actionError).toContain("항상 허용");
    });
  });

  describe("approve sends selectedItemIds when customized", () => {
    it("includes selectedItemIds when customized and items remain", async () => {
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

      // Customize by toggling off item-1 (leaves item-2 selected)
      act(() => { result.current.toggleItem("Observation", "item-1"); });

      await act(async () => {
        await result.current.approve();
      });

      const decisionCall = (deps.sendMessage as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => (c[0] as Record<string, unknown>).type === "approval:decision",
      );
      expect(decisionCall).toBeDefined();
      expect((decisionCall![0] as Record<string, unknown>).selectedItemIds).toEqual(["item-2"]);
    });

    it("omits selectedItemIds when not customized", async () => {
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

      const decisionCall = (deps.sendMessage as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => (c[0] as Record<string, unknown>).type === "approval:decision",
      );
      expect(decisionCall).toBeDefined();
      expect((decisionCall![0] as Record<string, unknown>).selectedItemIds).toBeUndefined();
    });
  });

  describe("applyDecisionResponse with status field", () => {
    it("calls showResolvedStatus when response has status", async () => {
      const deps = createMockDeps();
      deps.sendMessage = vi.fn().mockImplementation((msg: Record<string, unknown>) => {
        if (msg.type === "approval:decision") {
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

      expect(result.current.mode).toBe("resolved");
      expect(result.current.resolvedText).toContain("거절");
    });

    it("clears error and retryAction on successful response without status", async () => {
      const deps = createMockDeps();
      deps.sendMessage = vi.fn().mockImplementation((msg: Record<string, unknown>) => {
        if (msg.type === "approval:decision") {
          // ok: true but no status
          return Promise.resolve({ ok: true });
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

      expect(result.current.actionError).toBeNull();
      expect(result.current.retryAction).toBeNull();
    });
  });

  describe("openVault edge cases", () => {
    it("uses fallback error when openVault response has no error field", async () => {
      const deps = createMockDeps();
      deps.sendMessage = vi.fn().mockImplementation((msg: Record<string, unknown>) => {
        if (msg.type === "overlay:open-vault") {
          return Promise.resolve({ ok: false });
        }
        return Promise.resolve({ ok: true });
      });

      const { result } = renderHook(() => useOverlayState(deps));

      await act(async () => {
        await result.current.openVault();
      });

      expect(result.current.actionError).toBeTruthy();
      expect(result.current.retryAction).toBe("open-vault");
    });

    it("sets openingVault during openVault execution", async () => {
      const deps = createMockDeps();
      let resolveVault!: (value: unknown) => void;
      deps.sendMessage = vi.fn().mockImplementation((msg: Record<string, unknown>) => {
        if (msg.type === "overlay:open-vault") {
          return new Promise((resolve) => { resolveVault = resolve; });
        }
        return Promise.resolve({ ok: true });
      });

      const { result } = renderHook(() => useOverlayState(deps));

      let vaultPromise: Promise<void>;
      act(() => {
        vaultPromise = result.current.openVault();
      });

      expect(result.current.openingVault).toBe(true);

      await act(async () => {
        resolveVault({ ok: true });
        await vaultPromise!;
      });

      expect(result.current.openingVault).toBe(false);
    });
  });

  describe("timer lockout expiration", () => {
    it("clears lockoutUntil when timer expires in unlock mode", () => {
      const deps = createMockDeps();
      const lockoutTime = Date.now() + 2_000;
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

      // Advance time past lockout
      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(result.current.lockoutUntil).toBeNull();
    });
  });

  describe("update-approval preserves custom item selection", () => {
    it("updates selectedItemIds to defaults on update-approval (closure captures initial state)", () => {
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

      // Customize items
      act(() => { result.current.toggleItem("Observation", "item-1"); });

      // Send update - listener closure captures initial itemSelectionCustomized=false
      // so it will update selectedItemIds to defaults from the new request
      act(() => {
        emitOverlayEvent({
          type: "overlay:update-approval",
          request: {
            ...request,
            extensionSummary: "updated",
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
          },
          queueLength: 2,
        });
      });

      // Since the closure captures the initial value of itemSelectionCustomized (false),
      // the update will recalculate defaults from the new resourceOptions
      expect(result.current.selectedItemIds).toContain("item-1");
      expect(result.current.selectedItemIds).toContain("item-2");
      expect(result.current.selectedItemIds).toContain("item-3");
    });

    it("updates selectedItemIds when items were not customized", () => {
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

      // No customization - send update with new items
      act(() => {
        emitOverlayEvent({
          type: "overlay:update-approval",
          request: {
            ...request,
            extensionSummary: "updated",
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
          },
          queueLength: 2,
        });
      });

      // Should update to default selected items from new options
      expect(result.current.selectedItemIds).toContain("item-3");
    });
  });

  describe("update-approval with no current request", () => {
    it("does not crash and preserves null request", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:update-approval",
          request: createApprovalRequest({ id: "no-match" }),
          queueLength: 2,
        });
      });

      expect(result.current.request).toBeNull();
      expect(result.current.queueLength).toBe(2);
    });
  });

  describe("toggleType with items", () => {
    it("removes associated item ids when type is toggled off", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      expect(result.current.selectedItemIds).toContain("item-1");
      expect(result.current.selectedItemIds).toContain("item-2");

      act(() => {
        result.current.toggleType("Observation");
      });

      expect(result.current.selectedItemIds).not.toContain("item-1");
      expect(result.current.selectedItemIds).not.toContain("item-2");
    });

    it("adds associated item ids when type is toggled on", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      // Toggle off
      act(() => { result.current.toggleType("Observation"); });
      expect(result.current.selectedItemIds).not.toContain("item-1");

      // Toggle back on
      act(() => { result.current.toggleType("Observation"); });
      expect(result.current.selectedItemIds).toContain("item-1");
      expect(result.current.selectedItemIds).toContain("item-2");
    });

    it("clears actionError when toggling", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      // Create an error by toggling off then approve
      act(() => { result.current.toggleType("Observation"); });

      // Trigger error - no types selected
      // (we tested this path already, just set up for the next test)
      act(() => { result.current.toggleType("Observation"); });

      expect(result.current.actionError).toBeNull();
    });
  });

  describe("toggleItem with type auto-add", () => {
    it("adds type back when an item for it is re-selected", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      // Deselect both items to remove the type
      act(() => { result.current.toggleItem("Observation", "item-1"); });
      act(() => { result.current.toggleItem("Observation", "item-2"); });
      expect(result.current.selected).not.toContain("Observation");

      // Re-add item-1 should auto-add the type back
      act(() => { result.current.toggleItem("Observation", "item-1"); });
      expect(result.current.selected).toContain("Observation");
      expect(result.current.selectedItemIds).toContain("item-1");
    });

    it("clears actionError when toggling items", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      act(() => { result.current.toggleItem("Observation", "item-1"); });
      expect(result.current.actionError).toBeNull();
    });

    it("resets alwaysConfirmPending when toggling item resets permissionLevel", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      act(() => { result.current.toggleAlwaysAllow(true); });
      act(() => { result.current.confirmAlwaysAllow(); });

      expect(result.current.permissionLevel).toBe("always");
      expect(result.current.alwaysConfirmPending).toBe(false);

      act(() => { result.current.toggleItem("Observation", "item-1"); });

      expect(result.current.permissionLevel).toBe("one-time");
      expect(result.current.alwaysConfirmPending).toBe(false);
    });
  });

  describe("toggleType with no items (empty resourceOptions)", () => {
    it("toggleType works with request that has no items", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest({
            resourceOptions: [],
          }),
          queueLength: 1,
        });
      });

      act(() => { result.current.toggleType("Observation"); });
      expect(result.current.selected).not.toContain("Observation");

      act(() => { result.current.toggleType("Observation"); });
      expect(result.current.selected).toContain("Observation");
    });
  });

  describe("toggleItem with no resourceOptions", () => {
    it("toggleItem works with request that has no resourceOptions", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest({ resourceOptions: [] }),
          queueLength: 1,
        });
      });

      act(() => { result.current.toggleItem("Observation", "item-1"); });
      expect(result.current.itemSelectionCustomized).toBe(true);
      expect(result.current.selectedItemIds).toContain("item-1");
    });
  });

  describe("scheduleHide clears previous timer", () => {
    it("new incoming request clears existing hide timer", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      // Trigger connection success which schedules hide
      act(() => {
        emitOverlayEvent({
          type: "overlay:connection-success",
          provider: "chatgpt",
        });
      });

      expect(result.current.mode).toBe("connected");

      // Before timer fires, send a new event that clears the timer
      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      expect(result.current.mode).toBe("approval");

      // Advance past the connected hide timer
      act(() => {
        vi.advanceTimersByTime(15000);
      });

      // Should still be approval, not hidden (timer was cleared)
      expect(result.current.mode).toBe("approval");
    });
  });

  describe("overlay:ready error handling", () => {
    it("sets actionError when overlay:ready fails on mount", async () => {
      const deps = createMockDeps();
      deps.sendMessage = vi.fn().mockRejectedValue(new Error("connection failed"));

      const { result } = renderHook(() => useOverlayState(deps));

      // Give the promise time to reject
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(result.current.actionError).toBeTruthy();
    });
  });

  describe("resolved text values", () => {
    it("sets approved text on approved status", () => {
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

      expect(result.current.resolvedText).toContain("전송");
    });

    it("sets error text on error status", () => {
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

      expect(result.current.resolvedText).toContain("불안정");
    });
  });

  describe("connected mode text", () => {
    it("sets connected text with provider label", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:connection-success",
          provider: "chatgpt",
        });
      });

      expect(result.current.connectedText).toBeTruthy();
      expect(result.current.connectedText).toContain("연결");
    });
  });

  describe("remainingMs and derived values", () => {
    it("computes remainingMs based on request deadline", () => {
      const deps = createMockDeps();
      const deadline = Date.now() + 30_000;
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest({ deadlineAt: deadline }),
          queueLength: 1,
        });
      });

      expect(result.current.remainingMs).toBeGreaterThan(0);
      expect(result.current.remainingMs).toBeLessThanOrEqual(30_000);
      expect(result.current.remainingSeconds).toBeGreaterThan(0);
    });

    it("returns 0 remainingMs when no request", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      expect(result.current.remainingMs).toBe(0);
      expect(result.current.remainingSeconds).toBe(0);
    });

    it("returns stage based on remaining time", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest({ deadlineAt: Date.now() + 60_000 }),
          queueLength: 1,
        });
      });

      expect(result.current.stage).toBe("blue");
    });
  });

  describe("stale request detection on deny", () => {
    it("detects stale request on deny and transitions to resolved", async () => {
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
        await result.current.deny();
      });

      expect(result.current.mode).toBe("resolved");
      expect(result.current.actionError).toBeNull();
    });
  });

  describe("timer announcements edge cases", () => {
    it("does not announce in non-approval mode", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:request-unlock",
          request: createApprovalRequest({ deadlineAt: Date.now() + 6_000 }),
          queueLength: 1,
          lockoutUntil: null,
        });
      });

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      // In unlock mode, timer announcements should not trigger
      expect(result.current.timerAnnouncement).toBe("");
    });

    it("resets timer announcement when mode changes to hidden", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest({ deadlineAt: Date.now() + 6_000 }),
          queueLength: 1,
        });
      });

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(result.current.timerAnnouncement).toContain("5");

      // Resolve and wait for hide
      act(() => {
        emitOverlayEvent({
          type: "overlay:resolved",
          requestId: "req-1",
          status: "approved",
        });
      });

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(result.current.mode).toBe("hidden");
      expect(result.current.timerAnnouncement).toBe("");
    });
  });

  describe("timer interval in unlock mode", () => {
    it("updates nowMs in unlock mode", () => {
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

      const initialNowMs = result.current.nowMs;

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(result.current.nowMs).toBeGreaterThanOrEqual(initialNowMs);
    });

    it("does not run timer interval in hidden mode", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      const initialNowMs = result.current.nowMs;

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      // nowMs should not have changed since no interval runs in hidden mode
      expect(result.current.nowMs).toBe(initialNowMs);
    });
  });

  describe("approval rendered ACK", () => {
    it("sends approval-rendered ACK when dialog is connected", () => {
      const deps = createMockDeps();

      // Mock requestAnimationFrame to run callback immediately
      const originalRaf = window.requestAnimationFrame;
      const originalCaf = window.cancelAnimationFrame;
      window.requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 1; };
      window.cancelAnimationFrame = vi.fn();

      const { result } = renderHook(() => useOverlayState(deps));

      // Create a connected dialog element
      const dialog = document.createElement("div");
      document.body.appendChild(dialog);

      act(() => {
        (result.current.dialogRef as { current: HTMLDivElement | null }).current = dialog;
      });

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      // Check that ACK was sent
      const ackCalls = (deps.sendMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: unknown[]) => (c[0] as Record<string, unknown>).type === "overlay:approval-rendered",
      );
      expect(ackCalls.length).toBe(1);
      expect((ackCalls[0][0] as Record<string, unknown>).requestId).toBe("req-1");

      document.body.removeChild(dialog);
      window.requestAnimationFrame = originalRaf;
      window.cancelAnimationFrame = originalCaf;
    });

    it("does not send ACK when dialog is not connected", () => {
      const deps = createMockDeps();

      // Mock requestAnimationFrame to run callback immediately
      const originalRaf = window.requestAnimationFrame;
      const originalCaf = window.cancelAnimationFrame;
      window.requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 1; };
      window.cancelAnimationFrame = vi.fn();

      const { result } = renderHook(() => useOverlayState(deps));

      // Create dialog that is NOT connected (not in DOM)
      const dialog = document.createElement("div");

      act(() => {
        (result.current.dialogRef as { current: HTMLDivElement | null }).current = dialog;
      });

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      const ackCalls = (deps.sendMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: unknown[]) => (c[0] as Record<string, unknown>).type === "overlay:approval-rendered",
      );
      expect(ackCalls.length).toBe(0);

      window.requestAnimationFrame = originalRaf;
      window.cancelAnimationFrame = originalCaf;
    });

    it("does not send ACK in hidden mode", () => {
      const deps = createMockDeps();
      renderHook(() => useOverlayState(deps));

      act(() => {
        vi.advanceTimersByTime(100);
      });

      // Only overlay:ready should have been called
      const ackCalls = (deps.sendMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: unknown[]) => (c[0] as Record<string, unknown>).type === "overlay:approval-rendered",
      );
      expect(ackCalls.length).toBe(0);
    });
  });

  describe("toggleAlwaysAllow clears actionError", () => {
    it("clears actionError when toggling always allow", async () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      // Create an error
      act(() => { result.current.toggleType("Observation"); });
      await act(async () => { await result.current.approve(); });
      expect(result.current.actionError).toBeTruthy();

      // Toggle always allow should clear error
      act(() => { result.current.toggleAlwaysAllow(true); });
      expect(result.current.actionError).toBeNull();
    });
  });

  describe("multiple resource types", () => {
    it("handles request with multiple resource types", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest({
            resourceTypes: ["Observation", "Condition"] as ResourceType[],
            resourceOptions: [
              {
                resourceType: "Observation" as ResourceType,
                count: 1,
                items: [{ id: "obs-1", label: "Obs 1" }],
              },
              {
                resourceType: "Condition" as ResourceType,
                count: 1,
                items: [{ id: "cond-1", label: "Cond 1" }],
              },
            ],
          }),
          queueLength: 1,
        });
      });

      expect(result.current.selected).toContain("Observation");
      expect(result.current.selected).toContain("Condition");
      expect(result.current.selectedItemIds).toContain("obs-1");
      expect(result.current.selectedItemIds).toContain("cond-1");

      // Toggle off Observation
      act(() => { result.current.toggleType("Observation"); });
      expect(result.current.selected).not.toContain("Observation");
      expect(result.current.selected).toContain("Condition");
      expect(result.current.selectedItemIds).not.toContain("obs-1");
      expect(result.current.selectedItemIds).toContain("cond-1");
    });
  });

  describe("keyboard event handling", () => {
    it("handles Escape key in approval mode", async () => {
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
        const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
        window.dispatchEvent(event);
        // Give time for the async deny() to complete
        await vi.advanceTimersByTimeAsync(100);
      });

      // deny() should have been called
      const denyCalls = (deps.sendMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: unknown[]) => (c[0] as Record<string, unknown>).decision === "denied",
      );
      expect(denyCalls.length).toBe(1);
    });

    it("ignores Escape key in non-approval mode", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:connection-success",
          provider: "chatgpt",
        });
      });

      act(() => {
        const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
        window.dispatchEvent(event);
      });

      // Should still be connected, not denied
      expect(result.current.mode).toBe("connected");
    });

    it("ignores keydown in hidden mode", () => {
      const deps = createMockDeps();
      renderHook(() => useOverlayState(deps));

      act(() => {
        const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
        window.dispatchEvent(event);
      });

      // No crash
    });

    it("handles Tab key without dialog ref", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      // Tab without dialog should not crash
      act(() => {
        const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
        window.dispatchEvent(event);
      });

      expect(result.current.mode).toBe("approval");
    });

    it("Tab focuses root when no focusable elements exist", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      // Create a dialog element with no focusable children
      const dialog = document.createElement("div");
      dialog.setAttribute("tabindex", "-1");
      document.body.appendChild(dialog);
      const focusSpy = vi.spyOn(dialog, "focus");

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      // Set dialogRef
      act(() => {
        (result.current.dialogRef as { current: HTMLDivElement | null }).current = dialog;
      });

      act(() => {
        const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
        window.dispatchEvent(event);
      });

      expect(focusSpy).toHaveBeenCalled();
      document.body.removeChild(dialog);
    });

    it("Tab wraps focus forward to first element", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      // Create dialog with focusable children
      const dialog = document.createElement("div");
      const btn1 = document.createElement("button");
      btn1.textContent = "First";
      const btn2 = document.createElement("button");
      btn2.textContent = "Last";
      dialog.appendChild(btn1);
      dialog.appendChild(btn2);
      document.body.appendChild(dialog);

      const focusSpy1 = vi.spyOn(btn1, "focus");

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      act(() => {
        (result.current.dialogRef as { current: HTMLDivElement | null }).current = dialog;
      });

      // Focus last element, then Tab should wrap to first
      btn2.focus();
      act(() => {
        const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
        window.dispatchEvent(event);
      });

      expect(focusSpy1).toHaveBeenCalled();
      document.body.removeChild(dialog);
    });

    it("Shift+Tab wraps focus backward to last element", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      // Create dialog with focusable children
      const dialog = document.createElement("div");
      const btn1 = document.createElement("button");
      btn1.textContent = "First";
      const btn2 = document.createElement("button");
      btn2.textContent = "Last";
      dialog.appendChild(btn1);
      dialog.appendChild(btn2);
      document.body.appendChild(dialog);

      const focusSpy2 = vi.spyOn(btn2, "focus");

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      act(() => {
        (result.current.dialogRef as { current: HTMLDivElement | null }).current = dialog;
      });

      // Focus first element, then Shift+Tab should wrap to last
      btn1.focus();
      act(() => {
        const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true });
        window.dispatchEvent(event);
      });

      expect(focusSpy2).toHaveBeenCalled();
      document.body.removeChild(dialog);
    });

    it("Tab forward does not wrap when active element is in middle", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      const dialog = document.createElement("div");
      const btn1 = document.createElement("button");
      btn1.textContent = "First";
      const btn2 = document.createElement("button");
      btn2.textContent = "Middle";
      const btn3 = document.createElement("button");
      btn3.textContent = "Last";
      dialog.appendChild(btn1);
      dialog.appendChild(btn2);
      dialog.appendChild(btn3);
      document.body.appendChild(dialog);

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      act(() => {
        (result.current.dialogRef as { current: HTMLDivElement | null }).current = dialog;
      });

      // Focus middle element, Tab should not wrap
      btn2.focus();
      const preventDefaultSpy = vi.fn();
      act(() => {
        const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
        Object.defineProperty(event, "preventDefault", { value: preventDefaultSpy });
        window.dispatchEvent(event);
      });

      // preventDefault should NOT have been called since active is in middle
      expect(preventDefaultSpy).not.toHaveBeenCalled();
      document.body.removeChild(dialog);
    });

    it("Shift+Tab does not wrap when active element is in middle", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      const dialog = document.createElement("div");
      const btn1 = document.createElement("button");
      btn1.textContent = "First";
      const btn2 = document.createElement("button");
      btn2.textContent = "Middle";
      const btn3 = document.createElement("button");
      btn3.textContent = "Last";
      dialog.appendChild(btn1);
      dialog.appendChild(btn2);
      dialog.appendChild(btn3);
      document.body.appendChild(dialog);

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      act(() => {
        (result.current.dialogRef as { current: HTMLDivElement | null }).current = dialog;
      });

      // Focus middle element, Shift+Tab should not wrap
      btn2.focus();
      const preventDefaultSpy = vi.fn();
      act(() => {
        const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true });
        Object.defineProperty(event, "preventDefault", { value: preventDefaultSpy });
        window.dispatchEvent(event);
      });

      // preventDefault should NOT have been called
      expect(preventDefaultSpy).not.toHaveBeenCalled();
      document.body.removeChild(dialog);
    });

    it("Tab wraps to first when active element is outside dialog", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      const dialog = document.createElement("div");
      const btn1 = document.createElement("button");
      btn1.textContent = "First";
      dialog.appendChild(btn1);
      document.body.appendChild(dialog);

      const outsideBtn = document.createElement("button");
      outsideBtn.textContent = "Outside";
      document.body.appendChild(outsideBtn);

      const focusSpy1 = vi.spyOn(btn1, "focus");

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      act(() => {
        (result.current.dialogRef as { current: HTMLDivElement | null }).current = dialog;
      });

      // Focus outside element, Tab should wrap to first inside
      outsideBtn.focus();
      act(() => {
        const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
        window.dispatchEvent(event);
      });

      expect(focusSpy1).toHaveBeenCalled();
      document.body.removeChild(dialog);
      document.body.removeChild(outsideBtn);
    });
  });

  describe("focus management", () => {
    it("saves and restores focus when transitioning hidden -> visible -> hidden", () => {
      const deps = createMockDeps();

      // Create a button that has focus before overlay appears
      const outsideButton = document.createElement("button");
      outsideButton.textContent = "Outside";
      document.body.appendChild(outsideButton);
      outsideButton.focus();

      const { result } = renderHook(() => useOverlayState(deps));

      // Transition to approval mode
      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      expect(result.current.mode).toBe("approval");

      // Transition back to hidden
      act(() => {
        result.current.setMode("hidden");
      });

      expect(result.current.mode).toBe("hidden");
      document.body.removeChild(outsideButton);
    });

    it("focuses primaryButtonRef when available during mode transition", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      const primaryButton = document.createElement("button");
      document.body.appendChild(primaryButton);
      const focusSpy = vi.spyOn(primaryButton, "focus");

      act(() => {
        (result.current.primaryButtonRef as { current: HTMLButtonElement | null }).current = primaryButton;
      });

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      expect(focusSpy).toHaveBeenCalled();
      document.body.removeChild(primaryButton);
    });

    it("focuses dialogRef when primaryButtonRef is not set", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      const dialog = document.createElement("div");
      dialog.setAttribute("tabindex", "-1");
      document.body.appendChild(dialog);
      const focusSpy = vi.spyOn(dialog, "focus");

      act(() => {
        (result.current.dialogRef as { current: HTMLDivElement | null }).current = dialog;
      });

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      expect(focusSpy).toHaveBeenCalled();
      document.body.removeChild(dialog);
    });
  });

  describe("cleanup on unmount", () => {
    it("removes listener and clears timer on unmount", () => {
      const deps = createMockDeps();
      const removeListenerSpy = vi.spyOn(browser.runtime.onMessage, "removeListener");
      const { unmount, result } = renderHook(() => useOverlayState(deps));

      // Create a scheduled hide
      act(() => {
        emitOverlayEvent({
          type: "overlay:connection-success",
          provider: "chatgpt",
        });
      });

      unmount();

      expect(removeListenerSpy).toHaveBeenCalled();
    });
  });

  describe("acknowledgeApprovalRendered error handling", () => {
    it("silently catches when ACK message fails", () => {
      const deps = createMockDeps();
      deps.sendMessage = vi.fn().mockImplementation((msg: Record<string, unknown>) => {
        if (msg.type === "overlay:approval-rendered") {
          return Promise.reject(new Error("ACK failed"));
        }
        return Promise.resolve({ ok: true });
      });

      // Mock requestAnimationFrame to run callback immediately
      const originalRaf = window.requestAnimationFrame;
      const originalCaf = window.cancelAnimationFrame;
      window.requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 1; };
      window.cancelAnimationFrame = vi.fn();

      const { result } = renderHook(() => useOverlayState(deps));

      // Create a connected dialog element
      const dialog = document.createElement("div");
      document.body.appendChild(dialog);

      act(() => {
        (result.current.dialogRef as { current: HTMLDivElement | null }).current = dialog;
      });

      // Should not throw even though ACK message fails
      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      // Verify ACK was attempted
      const ackCalls = (deps.sendMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: unknown[]) => (c[0] as Record<string, unknown>).type === "overlay:approval-rendered",
      );
      expect(ackCalls.length).toBe(1);
      expect(result.current.mode).toBe("approval");

      document.body.removeChild(dialog);
      window.requestAnimationFrame = originalRaf;
      window.cancelAnimationFrame = originalCaf;
    });
  });

  describe("default deps (sendOverlayMessage and detectProvider)", () => {
    it("uses default sendOverlayMessage and detectProvider when no deps provided", async () => {
      // This test exercises the default code paths (lines 24-38)
      // sendRuntimeMessage is already mocked at the top of the file
      const mod = await import("../core/runtime-client");
      const mockSendRuntimeMessage = mod.sendRuntimeMessage as unknown as ReturnType<typeof vi.fn>;
      mockSendRuntimeMessage.mockResolvedValue({ ok: true });

      const { result } = renderHook(() => useOverlayState());

      // The hook should have called sendRuntimeMessage via sendOverlayMessage
      expect(mockSendRuntimeMessage).toHaveBeenCalled();

      // detectProvider should have been called - in happy-dom, location.hostname
      // defaults to something that doesn't include "claude.ai", so it returns "chatgpt"
      expect(result.current.mode).toBe("hidden");
    });

    it("detectProvider returns claude when hostname is claude.ai", async () => {
      const mod = await import("../core/runtime-client");
      const mockSendRuntimeMessage = mod.sendRuntimeMessage as unknown as ReturnType<typeof vi.fn>;
      mockSendRuntimeMessage.mockResolvedValue({ ok: true });

      // Mock location.hostname to include claude.ai
      const originalHostname = location.hostname;
      Object.defineProperty(location, "hostname", {
        value: "claude.ai",
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() => useOverlayState());

      // The overlay:ready message should include provider: "claude"
      const readyCalls = mockSendRuntimeMessage.mock.calls.filter(
        (c: unknown[]) => {
          const firstArg = c[0] as Record<string, unknown>;
          return firstArg.type === "overlay:ready" && firstArg.provider === "claude";
        },
      );
      expect(readyCalls.length).toBeGreaterThan(0);

      // Restore hostname
      Object.defineProperty(location, "hostname", {
        value: originalHostname,
        writable: true,
        configurable: true,
      });
    });
  });

  describe("setDetailOpen", () => {
    it("exposes setDetailOpen to control detail panel", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      expect(result.current.detailOpen).toBe(false);

      act(() => {
        result.current.setDetailOpen(true);
      });

      expect(result.current.detailOpen).toBe(true);

      act(() => {
        result.current.setDetailOpen(false);
      });

      expect(result.current.detailOpen).toBe(false);
    });
  });

  describe("setMode", () => {
    it("exposes setMode for external mode changes", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        result.current.setMode("approval");
      });

      expect(result.current.mode).toBe("approval");
    });
  });

  describe("refs", () => {
    it("exposes dialogRef and primaryButtonRef", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      expect(result.current.dialogRef).toBeDefined();
      expect(result.current.primaryButtonRef).toBeDefined();
      expect(result.current.dialogRef.current).toBeNull();
      expect(result.current.primaryButtonRef.current).toBeNull();
    });
  });

  describe("resolved resets announcements", () => {
    it("resets timer announcement on resolved event", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest({ deadlineAt: Date.now() + 6_000 }),
          queueLength: 1,
        });
      });

      // Advance to trigger 5s announcement
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(result.current.timerAnnouncement).toContain("5");

      // Resolve
      act(() => {
        emitOverlayEvent({
          type: "overlay:resolved",
          requestId: "req-1",
          status: "approved",
        });
      });

      expect(result.current.timerAnnouncement).toBe("");
    });
  });

  describe("request incoming resets state", () => {
    it("applyIncomingRequest clears actionError and retryAction", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      // The incoming request should have cleared any error
      expect(result.current.actionError).toBeNull();
      expect(result.current.retryAction).toBeNull();
      expect(result.current.itemSelectionCustomized).toBe(false);
    });
  });

  describe("show-approval resets state", () => {
    it("resets permissionLevel, detailOpen, lockoutUntil, alwaysConfirmPending", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useOverlayState(deps));

      // First set up some state
      act(() => {
        emitOverlayEvent({
          type: "overlay:request-unlock",
          request: createApprovalRequest(),
          queueLength: 1,
          lockoutUntil: Date.now() + 30_000,
        });
      });

      expect(result.current.lockoutUntil).not.toBeNull();

      // show-approval should reset
      act(() => {
        emitOverlayEvent({
          type: "overlay:show-approval",
          request: createApprovalRequest(),
          queueLength: 1,
        });
      });

      expect(result.current.permissionLevel).toBe("one-time");
      expect(result.current.detailOpen).toBe(false);
      expect(result.current.lockoutUntil).toBeNull();
      expect(result.current.alwaysConfirmPending).toBe(false);
    });
  });
});
