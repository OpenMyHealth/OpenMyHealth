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
});
