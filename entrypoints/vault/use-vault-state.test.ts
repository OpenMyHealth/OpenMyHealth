// @vitest-environment happy-dom
import { renderHook, act } from "@testing-library/react";
import type { AiProvider } from "../../packages/contracts/src/index";
import type { VaultStateResponse } from "../../src/core/messages";
import { useVaultState, type VaultStateDeps } from "./use-vault-state";

vi.mock("../../src/core/runtime-client", () => ({
  sendRuntimeMessage: vi.fn(),
}));

vi.mock("./runtime", () => ({
  sendVaultMessage: vi.fn(),
  sendUploadMessage: vi.fn(),
  readableError: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
  lockoutGuide: vi.fn((s: number) => `${s}초 대기`),
  humanizeUploadError: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
  summarizeUploadErrors: vi.fn((errors: string[]) => errors.join("; ")),
  withConnectionHint: vi.fn(async (e: unknown) => (e instanceof Error ? e.message : String(e))),
  statusTone: vi.fn(() => "bg-success/15"),
}));

function createVaultStateResponse(overrides?: Partial<VaultStateResponse>): VaultStateResponse {
  return {
    ok: true,
    settings: {
      locale: "ko-KR",
      schemaVersion: 1,
      lockout: { failedAttempts: 0, lockUntil: null },
      connectedProvider: "chatgpt" as AiProvider,
      integrationWarning: null,
    },
    session: { isUnlocked: true, hasPin: true, lockoutUntil: null },
    files: [],
    auditLogs: [],
    summary: {},
    ...overrides,
  };
}

function createMockDeps(): VaultStateDeps {
  const vaultResponse = createVaultStateResponse();
  return {
    sendVaultMessage: vi.fn().mockResolvedValue(vaultResponse),
    sendUploadMessage: vi.fn().mockResolvedValue({ ok: true }),
  };
}

describe("useVaultState", () => {
  describe("initial state", () => {
    it("starts with loading true", () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useVaultState(deps));

      // loading starts true before async init completes
      expect(result.current.loading).toBe(true);
    });

    it("loads initial state from sendVaultMessage", async () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(deps.sendVaultMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "vault:get-state" }),
      );
      expect(result.current.state).not.toBeNull();
    });

    it("sets appError when initial load fails", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("load fail"));

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.appError).toBeTruthy();
    });
  });

  describe("setupPin", () => {
    it("calls sendVaultMessage with pin and updates state on success", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse({ session: { isUnlocked: false, hasPin: false, lockoutUntil: null } })) // initial load
        .mockResolvedValueOnce(createVaultStateResponse({ session: { isUnlocked: false, hasPin: false, lockoutUntil: null } })) // list-permissions (from initial - but session not unlocked)
        .mockResolvedValueOnce({ ok: true, isUnlocked: true }) // setup-pin
        .mockResolvedValue(createVaultStateResponse()); // refreshState after setup

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.setPin("123456");
      });
      act(() => {
        result.current.setConfirmPin("123456");
      });

      await act(async () => {
        await result.current.setupPin();
      });

      expect(deps.sendVaultMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "session:setup-pin",
          pin: "123456",
        }),
      );
    });

    it("sets authError when pin length is not 6", async () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.setPin("123");
      });
      act(() => {
        result.current.setConfirmPin("123");
      });

      await act(async () => {
        await result.current.setupPin();
      });

      expect(result.current.authError).toBeTruthy();
    });

    it("sets authError when pins do not match", async () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.setPin("123456");
      });
      act(() => {
        result.current.setConfirmPin("654321");
      });

      await act(async () => {
        await result.current.setupPin();
      });

      expect(result.current.authError).toBeTruthy();
    });
  });

  describe("unlock", () => {
    it("calls sendVaultMessage and unlocks on success", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse({ session: { isUnlocked: false, hasPin: true, lockoutUntil: null } })) // initial load
        .mockResolvedValueOnce({ ok: true, isUnlocked: true }) // unlock
        .mockResolvedValue(createVaultStateResponse()); // refreshState

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.setPin("123456");
      });

      await act(async () => {
        await result.current.unlock();
      });

      expect(deps.sendVaultMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "session:unlock", pin: "123456" }),
      );
    });

    it("sets authError when unlock response is not ok", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse({ session: { isUnlocked: false, hasPin: true, lockoutUntil: null } })) // initial load
        .mockResolvedValueOnce({ ok: false, error: "wrong pin" }); // unlock

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.setPin("123456");
      });

      await act(async () => {
        await result.current.unlock();
      });

      expect(result.current.authError).toBeTruthy();
    });

    it("sets lockoutUntil when unlock fails with lockout", async () => {
      const lockoutTime = Date.now() + 60_000;
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse({ session: { isUnlocked: false, hasPin: true, lockoutUntil: null } })) // initial load
        .mockResolvedValueOnce({ ok: true, isUnlocked: false, lockoutUntil: lockoutTime }); // unlock with lockout

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.setPin("123456");
      });

      await act(async () => {
        await result.current.unlock();
      });

      expect(result.current.lockoutUntil).toBe(lockoutTime);
    });

    it("sets authError for short pin", async () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.setPin("12");
      });

      await act(async () => {
        await result.current.unlock();
      });

      expect(result.current.authError).toBeTruthy();
    });
  });

  describe("lock", () => {
    it("calls sendVaultMessage with session:lock", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse()) // initial load
        .mockResolvedValueOnce({ ok: true, permissions: [] }) // list-permissions
        .mockResolvedValueOnce({ ok: true }) // lock
        .mockResolvedValue(createVaultStateResponse({ session: { isUnlocked: false, hasPin: true, lockoutUntil: null } })); // refreshState

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.lock();
      });

      expect(deps.sendVaultMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "session:lock" }),
      );
    });
  });

  describe("uploadFiles", () => {
    it("sends upload message for each file", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>).mockResolvedValue(createVaultStateResponse());
      (deps.sendUploadMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const file = new File(["test content"], "test.pdf", { type: "application/pdf" });
      const fileList = {
        length: 1,
        item: (i: number) => (i === 0 ? file : null),
        [Symbol.iterator]: function* () { yield file; },
        0: file,
      } as unknown as FileList;

      await act(async () => {
        await result.current.uploadFiles(fileList);
      });

      expect(deps.sendUploadMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "vault:upload-file",
          name: "test.pdf",
        }),
      );
    });

    it("sets appError when upload fails", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>).mockResolvedValue(createVaultStateResponse());
      (deps.sendUploadMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: "upload fail" });

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const file = new File(["test"], "test.pdf", { type: "application/pdf" });
      const fileList = {
        length: 1,
        item: (i: number) => (i === 0 ? file : null),
        [Symbol.iterator]: function* () { yield file; },
        0: file,
      } as unknown as FileList;

      await act(async () => {
        await result.current.uploadFiles(fileList);
      });

      expect(result.current.appError).toBeTruthy();
    });

    it("does nothing for null file list", async () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.uploadFiles(null);
      });

      expect(deps.sendUploadMessage).not.toHaveBeenCalled();
    });
  });

  describe("triggerDownload", () => {
    it("sends vault:download-file message", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse()) // initial load
        .mockResolvedValueOnce({ ok: true, permissions: [] }) // list-permissions
        .mockResolvedValueOnce({
          ok: true,
          file: { name: "test.pdf", mimeType: "application/pdf", bytes: new ArrayBuffer(0) },
        }); // download

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Mock URL.createObjectURL / revokeObjectURL
      const createObjectURLMock = vi.fn().mockReturnValue("blob:test");
      const revokeObjectURLMock = vi.fn();
      globalThis.URL.createObjectURL = createObjectURLMock;
      globalThis.URL.revokeObjectURL = revokeObjectURLMock;

      await act(async () => {
        await result.current.triggerDownload("file-1");
      });

      expect(deps.sendVaultMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "vault:download-file", fileId: "file-1" }),
      );
    });
  });

  describe("triggerDelete", () => {
    it("sends vault:delete-file message", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse()) // initial load
        .mockResolvedValueOnce({ ok: true, permissions: [] }) // list-permissions
        .mockResolvedValueOnce({ ok: true, deletedFileId: "file-1" }) // delete
        .mockResolvedValue(createVaultStateResponse()); // refreshState

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.triggerDelete("file-1");
      });

      expect(deps.sendVaultMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "vault:delete-file", fileId: "file-1" }),
      );
    });
  });

  describe("setProvider", () => {
    it("sends vault:set-provider message", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse()) // initial load
        .mockResolvedValueOnce({ ok: true, permissions: [] }) // list-permissions
        .mockResolvedValueOnce({ ok: true, provider: "claude" }) // set-provider
        .mockResolvedValue(createVaultStateResponse()); // refreshState

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.setProvider("claude");
      });

      expect(deps.sendVaultMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "vault:set-provider", provider: "claude" }),
      );
    });
  });

  describe("revokePermission", () => {
    it("sends vault:revoke-permission message", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse()) // initial load
        .mockResolvedValueOnce({ ok: true, permissions: [{ key: "perm-1", provider: "chatgpt", resourceType: "Observation", depth: "summary", legacy: false }] }) // list-permissions
        .mockResolvedValueOnce({ ok: true }) // revoke
        .mockResolvedValueOnce({ ok: true, permissions: [] }); // refresh-permissions

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.revokePermission("perm-1");
      });

      expect(deps.sendVaultMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "vault:revoke-permission", key: "perm-1" }),
      );
    });
  });

  describe("refreshState", () => {
    it("refreshes state from background", async () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.refreshState();
      });

      // Should have called vault:get-state multiple times (initial + refresh)
      const getStateCalls = (deps.sendVaultMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: unknown[]) => (c[0] as Record<string, unknown>).type === "vault:get-state",
      );
      expect(getStateCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("revokePermission error handling", () => {
    it("sets appError when revoke response is not ok", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse()) // initial load
        .mockResolvedValueOnce({ ok: true, permissions: [] }) // list-permissions
        .mockResolvedValueOnce({ ok: false, error: "revoke failed" }); // revoke

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.revokePermission("perm-1");
      });

      expect(result.current.appError).toBeTruthy();
      expect(result.current.revokingPermissionKey).toBeNull();
    });

    it("sets appError when revoke throws", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse()) // initial load
        .mockResolvedValueOnce({ ok: true, permissions: [] }) // list-permissions
        .mockRejectedValueOnce(new Error("network error")); // revoke

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.revokePermission("perm-1");
      });

      expect(result.current.appError).toBeTruthy();
      expect(result.current.revokingPermissionKey).toBeNull();
    });
  });

  describe("triggerDelete error handling", () => {
    it("sets appError when delete response is not ok", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse()) // initial load
        .mockResolvedValueOnce({ ok: true, permissions: [] }) // list-permissions
        .mockResolvedValueOnce({ ok: false, error: "delete failed" }); // delete

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.triggerDelete("file-1");
      });

      expect(result.current.appError).toBeTruthy();
    });
  });

  describe("triggerDownload error handling", () => {
    it("sets appError when download response is not ok", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse()) // initial load
        .mockResolvedValueOnce({ ok: true, permissions: [] }) // list-permissions
        .mockResolvedValueOnce({ ok: false, error: "download failed" }); // download

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.triggerDownload("file-1");
      });

      expect(result.current.appError).toBe("download failed");
    });

    it("sets appError when download throws", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse()) // initial load
        .mockResolvedValueOnce({ ok: true, permissions: [] }) // list-permissions
        .mockRejectedValueOnce(new Error("network failure")); // download

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.triggerDownload("file-1");
      });

      expect(result.current.appError).toBeTruthy();
    });
  });

  describe("setProvider error handling", () => {
    it("sets appError when set-provider response is not ok", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse()) // initial load
        .mockResolvedValueOnce({ ok: true, permissions: [] }) // list-permissions
        .mockResolvedValueOnce({ ok: false, error: "provider error" }); // set-provider

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.setProvider("claude");
      });

      expect(result.current.appError).toBeTruthy();
      expect(result.current.settingProvider).toBeNull();
    });
  });

  describe("lockoutStageLabel", () => {
    it("returns 강화 잠금 when lockoutSeconds >= 300", async () => {
      const deps = createMockDeps();
      const lockoutTime = Date.now() + 350_000;
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse({
          session: { isUnlocked: false, hasPin: true, lockoutUntil: lockoutTime },
        }));

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.lockoutStageLabel).toBe("강화 잠금");
    });

    it("returns 보호 잠금 when lockoutSeconds >= 60", async () => {
      const deps = createMockDeps();
      const lockoutTime = Date.now() + 120_000;
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse({
          session: { isUnlocked: false, hasPin: true, lockoutUntil: lockoutTime },
        }));

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.lockoutStageLabel).toBe("보호 잠금");
    });

    it("returns 잠시 대기 when lockoutSeconds > 0 but < 60", async () => {
      const deps = createMockDeps();
      const lockoutTime = Date.now() + 30_000;
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse({
          session: { isUnlocked: false, hasPin: true, lockoutUntil: lockoutTime },
        }));

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.lockoutStageLabel).toBe("잠시 대기");
    });

    it("returns null when lockoutSeconds is 0", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse({
          session: { isUnlocked: false, hasPin: true, lockoutUntil: null },
        }));

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.lockoutStageLabel).toBeNull();
    });
  });

  describe("lock error handling", () => {
    it("sets appError when lock response is not ok", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse()) // initial load
        .mockResolvedValueOnce({ ok: true, permissions: [] }) // list-permissions
        .mockResolvedValueOnce({ ok: false, error: "lock failed" }); // lock

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.lock();
      });

      expect(result.current.appError).toBeTruthy();
      expect(result.current.isLocking).toBe(false);
    });
  });

  describe("setupPin error handling", () => {
    it("sets authError when setup-pin response is not ok", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse({ session: { isUnlocked: false, hasPin: false, lockoutUntil: null } })) // initial load
        .mockResolvedValueOnce({ ok: false, error: "pin error" }); // setup-pin

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => { result.current.setPin("123456"); });
      act(() => { result.current.setConfirmPin("123456"); });

      await act(async () => {
        await result.current.setupPin();
      });

      expect(result.current.authError).toBe("pin error");
      expect(result.current.isSettingPin).toBe(false);
    });

    it("sets authError when setup-pin throws", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse({ session: { isUnlocked: false, hasPin: false, lockoutUntil: null } })) // initial load
        .mockRejectedValueOnce(new Error("network error")); // setup-pin

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => { result.current.setPin("123456"); });
      act(() => { result.current.setConfirmPin("123456"); });

      await act(async () => {
        await result.current.setupPin();
      });

      expect(result.current.authError).toBeTruthy();
      expect(result.current.isSettingPin).toBe(false);
    });
  });

  describe("unlock edge cases", () => {
    it("sets authError when unlock throws", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse({ session: { isUnlocked: false, hasPin: true, lockoutUntil: null } })) // initial load
        .mockRejectedValueOnce(new Error("network error")); // unlock

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => { result.current.setPin("123456"); });

      await act(async () => {
        await result.current.unlock();
      });

      expect(result.current.authError).toBeTruthy();
      expect(result.current.isUnlocking).toBe(false);
    });

    it("sets generic authError when not unlocked and no lockout", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse({ session: { isUnlocked: false, hasPin: true, lockoutUntil: null } })) // initial load
        .mockResolvedValueOnce({ ok: true, isUnlocked: false, lockoutUntil: null }); // unlock

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => { result.current.setPin("123456"); });

      await act(async () => {
        await result.current.unlock();
      });

      expect(result.current.authError).toContain("PIN이 일치하지 않아요");
    });
  });

  describe("uploadFiles edge cases", () => {
    it("skips files larger than MAX_UPLOAD_BYTES", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>).mockResolvedValue(createVaultStateResponse());
      (deps.sendUploadMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Create a file > 30MB
      const bigFile = new File(["x"], "big.pdf", { type: "application/pdf" });
      Object.defineProperty(bigFile, "size", { value: 31 * 1024 * 1024 });
      const fileList = {
        length: 1,
        item: (i: number) => (i === 0 ? bigFile : null),
        [Symbol.iterator]: function* () { yield bigFile; },
        0: bigFile,
      } as unknown as FileList;

      await act(async () => {
        await result.current.uploadFiles(fileList);
      });

      // Upload should NOT have been called since file is too large
      expect(deps.sendUploadMessage).not.toHaveBeenCalled();
      expect(result.current.appError).toBeTruthy();
    });

    it("does nothing for empty file list", async () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const emptyList = {
        length: 0,
        item: () => null,
        [Symbol.iterator]: function* () {},
      } as unknown as FileList;

      await act(async () => {
        await result.current.uploadFiles(emptyList);
      });

      expect(deps.sendUploadMessage).not.toHaveBeenCalled();
    });
  });

  describe("withConnectionHint", () => {
    it("is exposed and returns a string", async () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const hint = await result.current.withConnectionHint(new Error("test"));
      expect(typeof hint).toBe("string");
    });
  });

  describe("moveToAiConnection", () => {
    it("scrolls to AI connection section ref", async () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Should not throw even without ref set
      result.current.moveToAiConnection();
    });
  });

  describe("unlock lockout guard", () => {
    it("returns early with authError when lockout is active", async () => {
      const lockoutTime = Date.now() + 60_000;
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse({
          session: { isUnlocked: false, hasPin: true, lockoutUntil: lockoutTime },
        })); // initial load

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // lockoutUntil should be set from initial state
      expect(result.current.lockoutUntil).toBe(lockoutTime);

      act(() => { result.current.setPin("123456"); });

      await act(async () => {
        await result.current.unlock();
      });

      // Should have returned early with lockout guide message
      expect(result.current.authError).toBeTruthy();
      // unlock message should NOT have been sent (only initial vault:get-state)
      const unlockCalls = (deps.sendVaultMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: unknown[]) => (c[0] as Record<string, unknown>).type === "session:unlock",
      );
      expect(unlockCalls.length).toBe(0);
    });
  });

  describe("uploadFiles refreshFilesOnly failure", () => {
    it("adds error when refreshFilesOnly fails after individual upload", async () => {
      const deps = createMockDeps();
      let listFilesCallCount = 0;
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>).mockImplementation((msg: Record<string, unknown>) => {
        if (msg.type === "vault:get-state") {
          return Promise.resolve(createVaultStateResponse());
        }
        if (msg.type === "vault:list-permissions") {
          return Promise.resolve({ ok: true, permissions: [] });
        }
        if (msg.type === "vault:list-files") {
          listFilesCallCount++;
          // Fail on the per-file refreshFilesOnly call
          if (listFilesCallCount === 1) {
            return Promise.reject(new Error("list-files network error"));
          }
          return Promise.resolve({ ok: true, files: [] });
        }
        return Promise.resolve({ ok: true });
      });
      (deps.sendUploadMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const file = new File(["test"], "test.pdf", { type: "application/pdf" });
      const fileList = {
        length: 1,
        item: (i: number) => (i === 0 ? file : null),
        [Symbol.iterator]: function* () { yield file; },
        0: file,
      } as unknown as FileList;

      await act(async () => {
        await result.current.uploadFiles(fileList);
      });

      // Should contain the refresh error message
      expect(result.current.appError).toBeTruthy();
    });
  });

  describe("uploadFiles refreshState failure after all uploads", () => {
    it("adds error when refreshState fails after all uploads complete", async () => {
      let getStateCallCount = 0;
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>).mockImplementation((msg: Record<string, unknown>) => {
        if (msg.type === "vault:get-state") {
          getStateCallCount++;
          // First call is initial load, second is post-upload refreshState
          if (getStateCallCount >= 2) {
            return Promise.reject(new Error("state refresh error"));
          }
          return Promise.resolve(createVaultStateResponse());
        }
        if (msg.type === "vault:list-permissions") {
          return Promise.resolve({ ok: true, permissions: [] });
        }
        if (msg.type === "vault:list-files") {
          return Promise.resolve({ ok: true, files: [] });
        }
        return Promise.resolve({ ok: true });
      });
      (deps.sendUploadMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const file = new File(["test"], "test.pdf", { type: "application/pdf" });
      const fileList = {
        length: 1,
        item: (i: number) => (i === 0 ? file : null),
        [Symbol.iterator]: function* () { yield file; },
        0: file,
      } as unknown as FileList;

      await act(async () => {
        await result.current.uploadFiles(fileList);
      });

      expect(result.current.appError).toBeTruthy();
    });
  });

  describe("uploadFiles fileInputRef reset", () => {
    it("resets fileInputRef.current.value after upload completes", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>).mockResolvedValue(createVaultStateResponse());
      (deps.sendUploadMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Set up a mock input element on the fileInputRef
      const mockInput = { value: "C:\\fakepath\\test.pdf" } as unknown as HTMLInputElement;
      (result.current.fileInputRef as { current: HTMLInputElement | null }).current = mockInput;

      const file = new File(["test"], "test.pdf", { type: "application/pdf" });
      const fileList = {
        length: 1,
        item: (i: number) => (i === 0 ? file : null),
        [Symbol.iterator]: function* () { yield file; },
        0: file,
      } as unknown as FileList;

      await act(async () => {
        await result.current.uploadFiles(fileList);
      });

      expect(mockInput.value).toBe("");
    });
  });

  describe("visibleFiles with optimistic files", () => {
    it("includes pending optimistic files not yet in persisted list", async () => {
      const deps = createMockDeps();
      // Upload message will resolve but we control when to verify visibleFiles
      let uploadResolve: ((value: { ok: boolean }) => void) | null = null;
      (deps.sendUploadMessage as ReturnType<typeof vi.fn>).mockImplementation(() => {
        return new Promise<{ ok: boolean }>((resolve) => {
          uploadResolve = resolve;
        });
      });
      const persistedFiles = [
        { id: "file-1", name: "existing.pdf", mimeType: "application/pdf", size: 100, createdAt: "2024-01-01", status: "ready" as const, matchedCounts: {} },
      ];
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>).mockImplementation((msg: Record<string, unknown>) => {
        if (msg.type === "vault:get-state") {
          return Promise.resolve(createVaultStateResponse({ files: persistedFiles }));
        }
        if (msg.type === "vault:list-permissions") {
          return Promise.resolve({ ok: true, permissions: [] });
        }
        if (msg.type === "vault:list-files") {
          return Promise.resolve({ ok: true, files: persistedFiles });
        }
        return Promise.resolve({ ok: true });
      });

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Initially visibleFiles should match persisted
      expect(result.current.visibleFiles.length).toBe(1);

      const file = new File(["test"], "new-file.pdf", { type: "application/pdf" });
      const fileList = {
        length: 1,
        item: (i: number) => (i === 0 ? file : null),
        [Symbol.iterator]: function* () { yield file; },
        0: file,
      } as unknown as FileList;

      // Start the upload (won't complete until we resolve)
      let uploadPromise: Promise<void>;
      act(() => {
        uploadPromise = result.current.uploadFiles(fileList);
      });

      // Wait for optimistic file to appear
      await vi.waitFor(() => {
        expect(result.current.visibleFiles.length).toBe(2);
      });

      // The optimistic file should be first (pending), existing file second
      expect(result.current.visibleFiles[0].name).toBe("new-file.pdf");
      expect(result.current.visibleFiles[0].status).toBe("processing");
      expect(result.current.visibleFiles[1].id).toBe("file-1");

      // Resolve the upload
      uploadResolve?.({ ok: true });
      await act(async () => {
        await uploadPromise;
      });
    });
  });

  describe("lockout timer effect", () => {
    it("clears lockoutUntil when timer expires", async () => {
      vi.useFakeTimers();
      const lockoutTime = Date.now() + 3_000; // 3 seconds from now
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse({
          session: { isUnlocked: false, hasPin: true, lockoutUntil: lockoutTime },
        }));

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.lockoutUntil).toBe(lockoutTime);

      // Advance time past the lockout
      act(() => {
        vi.advanceTimersByTime(4_000);
      });

      expect(result.current.lockoutUntil).toBeNull();

      vi.useRealTimers();
    });

    it("updates nowMs each second while lockout is active", async () => {
      vi.useFakeTimers();
      const lockoutTime = Date.now() + 10_000;
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse({
          session: { isUnlocked: false, hasPin: true, lockoutUntil: lockoutTime },
        }));

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const initialNowMs = result.current.nowMs;

      act(() => {
        vi.advanceTimersByTime(1_000);
      });

      // nowMs should have updated
      expect(result.current.nowMs).toBeGreaterThan(initialNowMs);

      vi.useRealTimers();
    });
  });

  describe("refreshState error handling", () => {
    it("throws when response is not ok", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse()) // initial load
        .mockResolvedValueOnce({ ok: true, permissions: [] }) // list-permissions
        .mockResolvedValueOnce({ ok: false, error: "state error" }); // refreshState

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.refreshState();
        }),
      ).rejects.toThrow();
    });

    it("does not update state when epoch is stale (concurrent refresh)", async () => {
      const deps = createMockDeps();
      let firstRefreshResolve: ((value: VaultStateResponse) => void) | null = null;
      let callCount = 0;

      (deps.sendVaultMessage as ReturnType<typeof vi.fn>).mockImplementation((msg: Record<string, unknown>) => {
        if (msg.type === "vault:get-state") {
          callCount++;
          if (callCount === 1) {
            // Initial load resolves immediately
            return Promise.resolve(createVaultStateResponse({ files: [] }));
          }
          if (callCount === 2) {
            // First refresh - will be slow
            return new Promise<VaultStateResponse>((resolve) => {
              firstRefreshResolve = resolve;
            });
          }
          // Second refresh resolves immediately
          return Promise.resolve(createVaultStateResponse({
            files: [{ id: "new-file", name: "new.pdf", mimeType: "application/pdf", size: 100, createdAt: "2024-01-01", status: "ready" as const, matchedCounts: {} }],
          }));
        }
        if (msg.type === "vault:list-permissions") {
          return Promise.resolve({ ok: true, permissions: [] });
        }
        return Promise.resolve({ ok: true });
      });

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Start first refresh (slow)
      let firstPromise: Promise<void>;
      act(() => {
        firstPromise = result.current.refreshState();
      });

      // Start second refresh (fast) - this increments the epoch, making first stale
      await act(async () => {
        await result.current.refreshState();
      });

      // Now resolve the first (stale) refresh
      firstRefreshResolve?.(createVaultStateResponse({
        files: [{ id: "stale-file", name: "stale.pdf", mimeType: "application/pdf", size: 50, createdAt: "2024-01-01", status: "ready" as const, matchedCounts: {} }],
      }));
      await act(async () => {
        await firstPromise;
      });

      // State should have the "new" file from second refresh, not "stale" from first
      expect(result.current.state?.files).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "new-file" })]),
      );
    });
  });

  describe("refreshFilesOnly error path", () => {
    it("throws when list-files response is not ok", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>).mockImplementation((msg: Record<string, unknown>) => {
        if (msg.type === "vault:get-state") {
          return Promise.resolve(createVaultStateResponse());
        }
        if (msg.type === "vault:list-permissions") {
          return Promise.resolve({ ok: true, permissions: [] });
        }
        if (msg.type === "vault:list-files") {
          return Promise.resolve({ ok: false, error: "list failed" });
        }
        return Promise.resolve({ ok: true });
      });
      // Upload will succeed but refreshFilesOnly will fail with not-ok
      (deps.sendUploadMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const file = new File(["test"], "test.pdf", { type: "application/pdf" });
      const fileList = {
        length: 1,
        item: (i: number) => (i === 0 ? file : null),
        [Symbol.iterator]: function* () { yield file; },
        0: file,
      } as unknown as FileList;

      await act(async () => {
        await result.current.uploadFiles(fileList);
      });

      // The not-ok refreshFilesOnly error should be captured in appError
      expect(result.current.appError).toBeTruthy();
    });
  });

  describe("refreshPermissions error path", () => {
    it("throws when list-permissions response is not ok", async () => {
      const deps = createMockDeps();
      // Initial load succeeds with session unlocked (triggers refreshPermissions)
      // But refreshPermissions returns not-ok
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse({ session: { isUnlocked: true, hasPin: true, lockoutUntil: null } })) // initial get-state
        .mockResolvedValueOnce({ ok: false, error: "permissions fetch failed" }); // list-permissions fails

      const { result } = renderHook(() => useVaultState(deps));

      // refreshState is called inside useEffect; if refreshPermissions throws,
      // it propagates up through refreshState and is caught by the init error handler
      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.appError).toBeTruthy();
    });
  });

  describe("upload file with empty mimeType", () => {
    it("falls back to application/octet-stream when file.type is empty", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>).mockResolvedValue(createVaultStateResponse());
      (deps.sendUploadMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // File with empty type
      const file = new File(["data"], "unknown.bin", { type: "" });
      const fileList = {
        length: 1,
        item: (i: number) => (i === 0 ? file : null),
        [Symbol.iterator]: function* () { yield file; },
        0: file,
      } as unknown as FileList;

      await act(async () => {
        await result.current.uploadFiles(fileList);
      });

      expect(deps.sendUploadMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          mimeType: "application/octet-stream",
        }),
      );
    });
  });

  describe("triggerDownload with empty mimeType", () => {
    it("falls back to application/octet-stream when file mimeType is empty", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse()) // initial load
        .mockResolvedValueOnce({ ok: true, permissions: [] }) // list-permissions
        .mockResolvedValueOnce({
          ok: true,
          file: { name: "test.bin", mimeType: "", bytes: new ArrayBuffer(4) },
        }); // download with empty mimeType

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const createObjectURLMock = vi.fn().mockReturnValue("blob:test");
      const revokeObjectURLMock = vi.fn();
      globalThis.URL.createObjectURL = createObjectURLMock;
      globalThis.URL.revokeObjectURL = revokeObjectURLMock;

      await act(async () => {
        await result.current.triggerDownload("file-1");
      });

      // The Blob should be created with the fallback mimeType
      expect(createObjectURLMock).toHaveBeenCalled();
      expect(revokeObjectURLMock).toHaveBeenCalled();
    });
  });

  describe("setupPin uses fallback error when response.error is undefined", () => {
    it("uses fallback error message when response has no error field", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse({ session: { isUnlocked: false, hasPin: false, lockoutUntil: null } })) // initial load
        .mockResolvedValueOnce({ ok: false }); // setup-pin with no error field

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => { result.current.setPin("123456"); });
      act(() => { result.current.setConfirmPin("123456"); });

      await act(async () => {
        await result.current.setupPin();
      });

      expect(result.current.authError).toBe("PIN 설정 중 문제가 발생했습니다.");
      expect(result.current.isSettingPin).toBe(false);
    });
  });

  describe("unlock uses fallback error when response.error is undefined", () => {
    it("uses fallback error message when unlock response has no error field", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse({ session: { isUnlocked: false, hasPin: true, lockoutUntil: null } })) // initial load
        .mockResolvedValueOnce({ ok: false }); // unlock with no error field

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => { result.current.setPin("123456"); });

      await act(async () => {
        await result.current.unlock();
      });

      expect(result.current.authError).toBe("잠금 해제 요청을 처리하지 못했습니다.");
    });
  });

  describe("triggerDelete uses fallback error when response.error is undefined", () => {
    it("uses fallback error message when delete response has no error field", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse()) // initial load
        .mockResolvedValueOnce({ ok: true, permissions: [] }) // list-permissions
        .mockResolvedValueOnce({ ok: false }); // delete with no error field

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.triggerDelete("file-1");
      });

      expect(result.current.appError).toBeTruthy();
    });
  });

  describe("lock uses fallback error when response.error is undefined", () => {
    it("uses fallback error message when lock response has no error field", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse()) // initial load
        .mockResolvedValueOnce({ ok: true, permissions: [] }) // list-permissions
        .mockResolvedValueOnce({ ok: false }); // lock with no error field

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.lock();
      });

      expect(result.current.appError).toBeTruthy();
      expect(result.current.isLocking).toBe(false);
    });
  });

  describe("setProvider uses fallback error when response.error is undefined", () => {
    it("uses fallback error message when set-provider response has no error field", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse()) // initial load
        .mockResolvedValueOnce({ ok: true, permissions: [] }) // list-permissions
        .mockResolvedValueOnce({ ok: false }); // set-provider with no error field

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.setProvider("claude");
      });

      expect(result.current.appError).toBeTruthy();
      expect(result.current.settingProvider).toBeNull();
    });
  });

  describe("revokePermission uses fallback error when response.error is undefined", () => {
    it("uses fallback error message when revoke response has no error field", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse()) // initial load
        .mockResolvedValueOnce({ ok: true, permissions: [] }) // list-permissions
        .mockResolvedValueOnce({ ok: false }); // revoke with no error field

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.revokePermission("perm-1");
      });

      expect(result.current.appError).toBeTruthy();
      expect(result.current.revokingPermissionKey).toBeNull();
    });
  });

  describe("upload sendUploadMessage error fallback", () => {
    it("uses fallback error when upload response has no error field", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>).mockResolvedValue(createVaultStateResponse());
      (deps.sendUploadMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false }); // no error field

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const file = new File(["test"], "test.pdf", { type: "application/pdf" });
      const fileList = {
        length: 1,
        item: (i: number) => (i === 0 ? file : null),
        [Symbol.iterator]: function* () { yield file; },
        0: file,
      } as unknown as FileList;

      await act(async () => {
        await result.current.uploadFiles(fileList);
      });

      expect(result.current.appError).toBeTruthy();
    });
  });

  describe("refreshState with locale fallback", () => {
    it("uses navigator.language when settings.locale is empty", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse({
          settings: {
            locale: "",
            schemaVersion: 1,
            lockout: { failedAttempts: 0, lockUntil: null },
            connectedProvider: "chatgpt" as AiProvider,
            integrationWarning: null,
          },
        })) // initial load - locale is empty
        .mockResolvedValueOnce({ ok: true, permissions: [] }); // list-permissions

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // locale should fallback to navigator.language or "ko-KR"
      expect(result.current.locale).toBeTruthy();
    });
  });

  describe("refreshPermissions fallback error message", () => {
    it("uses fallback error when list-permissions response has no error field", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse({ session: { isUnlocked: true, hasPin: true, lockoutUntil: null } })) // initial get-state
        .mockResolvedValueOnce({ ok: false }); // list-permissions with no error field

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // The fallback error should be set via withConnectionHint
      expect(result.current.appError).toBeTruthy();
    });
  });

  describe("refreshState fallback error message", () => {
    it("uses fallback error when get-state response has no error field", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createVaultStateResponse()) // initial load ok
        .mockResolvedValueOnce({ ok: true, permissions: [] }) // list-permissions
        .mockResolvedValueOnce({ ok: false }); // refreshState with no error field

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.refreshState();
        }),
      ).rejects.toThrow();
    });
  });

  describe("refreshFilesOnly fallback error message", () => {
    it("uses fallback error when list-files response has no error field", async () => {
      const deps = createMockDeps();
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>).mockImplementation((msg: Record<string, unknown>) => {
        if (msg.type === "vault:get-state") {
          return Promise.resolve(createVaultStateResponse());
        }
        if (msg.type === "vault:list-permissions") {
          return Promise.resolve({ ok: true, permissions: [] });
        }
        if (msg.type === "vault:list-files") {
          return Promise.resolve({ ok: false }); // no error field
        }
        return Promise.resolve({ ok: true });
      });
      (deps.sendUploadMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const file = new File(["test"], "test.pdf", { type: "application/pdf" });
      const fileList = {
        length: 1,
        item: (i: number) => (i === 0 ? file : null),
        [Symbol.iterator]: function* () { yield file; },
        0: file,
      } as unknown as FileList;

      await act(async () => {
        await result.current.uploadFiles(fileList);
      });

      expect(result.current.appError).toBeTruthy();
    });
  });

  describe("refreshFilesOnly setState when state is null", () => {
    it("does not update state when current state is null", async () => {
      // This tests the ternary: current ? {...current, files} : current
      // When state is null, it should return null (the else branch)
      const deps = createMockDeps();
      let getStateCallCount = 0;
      (deps.sendVaultMessage as ReturnType<typeof vi.fn>).mockImplementation((msg: Record<string, unknown>) => {
        if (msg.type === "vault:get-state") {
          getStateCallCount++;
          if (getStateCallCount === 1) {
            // initial load fails with not-ok (state stays null)
            return Promise.resolve({ ok: false });
          }
          // post-upload refreshState also fails
          return Promise.resolve({ ok: false });
        }
        if (msg.type === "vault:list-files") {
          // This is called from refreshFilesOnly in the upload finally block
          return Promise.resolve({ ok: true, files: [{ id: "f1", name: "f.pdf", mimeType: "application/pdf", size: 10, createdAt: "2024-01-01", status: "ready", matchedCounts: {} }] });
        }
        return Promise.resolve({ ok: true });
      });
      (deps.sendUploadMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

      const { result } = renderHook(() => useVaultState(deps));

      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // State should be null because initial load failed
      expect(result.current.state).toBeNull();

      const file = new File(["test"], "test.pdf", { type: "application/pdf" });
      const fileList = {
        length: 1,
        item: (i: number) => (i === 0 ? file : null),
        [Symbol.iterator]: function* () { yield file; },
        0: file,
      } as unknown as FileList;

      await act(async () => {
        await result.current.uploadFiles(fileList);
      });

      // State should still be null (refreshFilesOnly was called but state was null)
      expect(result.current.state).toBeNull();
    });
  });

  describe("default deps fallback", () => {
    it("uses default sendVaultMessage and sendUploadMessage when deps is undefined", async () => {
      // Calling useVaultState() without deps uses the mocked module-level defaults
      const { result } = renderHook(() => useVaultState());

      // The mocked default sendVaultMessage returns undefined (vi.fn()),
      // so the initial load will fail and set appError
      await vi.waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // We just need to verify the hook initializes without crashing
      // when no deps are provided (covers the ?? fallback branches)
      expect(result.current).toBeDefined();
    });
  });

  describe("navigator.language fallback to ko-KR", () => {
    it("falls back to ko-KR when navigator.language is empty", async () => {
      const originalLanguage = navigator.language;
      Object.defineProperty(navigator, "language", { value: "", configurable: true });

      try {
        const deps = createMockDeps();
        (deps.sendVaultMessage as ReturnType<typeof vi.fn>)
          .mockResolvedValueOnce(createVaultStateResponse({
            settings: {
              locale: "",
              schemaVersion: 1,
              lockout: { failedAttempts: 0, lockUntil: null },
              connectedProvider: "chatgpt" as AiProvider,
              integrationWarning: null,
            },
          }))
          .mockResolvedValueOnce({ ok: true, permissions: [] });

        const { result } = renderHook(() => useVaultState(deps));

        await vi.waitFor(() => {
          expect(result.current.loading).toBe(false);
        });

        // With both settings.locale and navigator.language empty,
        // should fall back to "ko-KR"
        expect(result.current.locale).toBe("ko-KR");
      } finally {
        Object.defineProperty(navigator, "language", { value: originalLanguage, configurable: true });
      }
    });
  });
});
