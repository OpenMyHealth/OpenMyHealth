// @vitest-environment happy-dom
import { renderHook, act } from "@testing-library/react";
import { useToast, toast, reducer, resetToastState } from "./use-toast";

describe("use-toast", () => {
  beforeEach(() => {
    resetToastState();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("reducer", () => {
    it("ADD_TOAST adds a toast to state", () => {
      const state = { toasts: [] };
      const newToast = { id: "1", title: "hello" };
      const result = reducer(state, { type: "ADD_TOAST", toast: newToast });
      expect(result.toasts).toHaveLength(1);
      expect(result.toasts[0]).toEqual(newToast);
    });

    it("DISMISS_TOAST removes matching toast", () => {
      const state = { toasts: [{ id: "1", title: "a" }, { id: "2", title: "b" }] };
      const result = reducer(state, { type: "DISMISS_TOAST", toastId: "1" });
      expect(result.toasts).toHaveLength(1);
      expect(result.toasts[0].id).toBe("2");
    });

    it("REMOVE_TOAST removes toast from array", () => {
      const state = { toasts: [{ id: "1", title: "a" }, { id: "2", title: "b" }] };
      const result = reducer(state, { type: "REMOVE_TOAST", toastId: "2" });
      expect(result.toasts).toHaveLength(1);
      expect(result.toasts[0].id).toBe("1");
    });
  });

  describe("toast()", () => {
    it("returns { id, dismiss }", () => {
      const result = toast({ title: "test" });
      expect(result).toHaveProperty("id");
      expect(typeof result.id).toBe("string");
      expect(typeof result.dismiss).toBe("function");
    });
  });

  describe("useToast()", () => {
    it("returns current toasts array", () => {
      const { result } = renderHook(() => useToast());
      act(() => {
        toast({ title: "first" });
      });
      expect(result.current.toasts).toHaveLength(1);
      expect(result.current.toasts[0].title).toBe("first");
    });
  });

  it("auto-removes after delay", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      toast({ title: "auto" });
    });
    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.toasts).toHaveLength(0);
  });

  it("dismiss() removes specific toast", () => {
    const { result } = renderHook(() => useToast());
    let t1: ReturnType<typeof toast>;
    act(() => {
      t1 = toast({ title: "one" });
      toast({ title: "two" });
    });
    expect(result.current.toasts).toHaveLength(2);

    act(() => {
      t1.dismiss();
    });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].title).toBe("two");
  });

  it("hook dismiss() removes specific toast by id", () => {
    const { result } = renderHook(() => useToast());
    let t1Id: string;
    act(() => {
      const t1 = toast({ title: "one" });
      t1Id = t1.id;
      toast({ title: "two" });
    });
    expect(result.current.toasts).toHaveLength(2);

    act(() => {
      result.current.dismiss(t1Id);
    });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].title).toBe("two");
  });

  it("multiple toasts tracked independently", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      toast({ title: "a" });
      toast({ title: "b" });
      toast({ title: "c" });
    });
    expect(result.current.toasts).toHaveLength(3);
    const titles = result.current.toasts.map((t) => t.title);
    expect(titles).toContain("a");
    expect(titles).toContain("b");
    expect(titles).toContain("c");
  });
});
