// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { UploadSection } from "./upload-section";
import type { VaultFileSummary } from "../../../src/core/models";

vi.mock("../../../src/core/utils", () => ({
  fileStatusLabel: (s: string) => ({ processing: "처리 중", done: "완료", error: "오류" })[s],
  resourceLabel: (t: string) => t,
}));

function makeFile(overrides: Partial<VaultFileSummary> = {}): VaultFileSummary {
  return {
    id: "f1",
    name: "blood-test.pdf",
    mimeType: "application/pdf",
    size: 1024 * 1024,
    createdAt: "2025-01-01T00:00:00Z",
    status: "done",
    matchedCounts: { Observation: 3 },
    ...overrides,
  };
}

function renderUpload(overrides: Partial<Parameters<typeof UploadSection>[0]> = {}) {
  const ref = React.createRef<HTMLInputElement>();
  const defaultProps = {
    hasFiles: false,
    uploading: false,
    isBusy: false,
    fileInputRef: ref,
    uploadFiles: vi.fn().mockResolvedValue(undefined),
    moveToAiConnection: vi.fn(),
    visibleFiles: [] as VaultFileSummary[],
    statusTone: vi.fn().mockReturnValue("text-success"),
    triggerDownload: vi.fn().mockResolvedValue(undefined),
    triggerDelete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { ...render(<UploadSection {...defaultProps} />), props: defaultProps };
}

describe("UploadSection", () => {
  it("renders empty state when no files", () => {
    renderUpload();
    expect(screen.getByText(/아직 업로드한 기록이 없습니다/)).toBeInTheDocument();
  });

  it("renders file picker trigger buttons", () => {
    renderUpload();
    expect(screen.getByRole("button", { name: "PDF/문서 선택" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "사진 선택" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "전체 형식" })).toBeInTheDocument();
  });

  it("file list shows uploaded files", () => {
    const file = makeFile();
    renderUpload({ visibleFiles: [file], hasFiles: true });
    expect(screen.getByText("blood-test.pdf")).toBeInTheDocument();
  });

  it("shows status badge for done file", () => {
    const file = makeFile({ status: "done" });
    renderUpload({ visibleFiles: [file] });
    expect(screen.getByText("완료")).toBeInTheDocument();
  });

  it("shows status badge for processing file", () => {
    const file = makeFile({ status: "processing" });
    renderUpload({ visibleFiles: [file] });
    expect(screen.getByText("처리 중")).toBeInTheDocument();
  });

  it("shows status badge for error file", () => {
    const file = makeFile({ status: "error" });
    renderUpload({ visibleFiles: [file] });
    expect(screen.getByText("오류")).toBeInTheDocument();
  });

  it("download button calls triggerDownload with fileId", () => {
    const file = makeFile({ id: "file-123" });
    const { props } = renderUpload({ visibleFiles: [file] });
    const btn = screen.getByLabelText("blood-test.pdf 다운로드");
    fireEvent.click(btn);
    expect(props.triggerDownload).toHaveBeenCalledWith("file-123");
  });

  it("delete button calls triggerDelete with fileId for done files", () => {
    const file = makeFile({ id: "file-456" });
    const { props } = renderUpload({ visibleFiles: [file] });
    const btn = screen.getByLabelText("blood-test.pdf 삭제");
    fireEvent.click(btn);
    expect(props.triggerDelete).toHaveBeenCalledWith("file-456");
  });

  it("delete button shown for error files", () => {
    const file = makeFile({ id: "file-err", status: "error", name: "bad.pdf" });
    const { props } = renderUpload({ visibleFiles: [file] });
    const btn = screen.getByLabelText("bad.pdf 삭제");
    fireEvent.click(btn);
    expect(props.triggerDelete).toHaveBeenCalledWith("file-err");
  });

  it("disables picker buttons when isBusy", () => {
    renderUpload({ isBusy: true });
    expect(screen.getByRole("button", { name: "PDF/문서 선택" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "사진 선택" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "전체 형식" })).toBeDisabled();
  });

  it("shows uploading text when uploading is true", () => {
    renderUpload({ uploading: true });
    expect(screen.getByText("업로드 처리 중...")).toBeInTheDocument();
  });

  it("shows '업로드 마치고 AI 연결하기' button when hasFiles is true", () => {
    renderUpload({ hasFiles: true });
    expect(screen.getByRole("button", { name: /업로드 마치고 AI 연결하기/ })).toBeInTheDocument();
  });

  it("calls moveToAiConnection when skip button clicked", () => {
    const { props } = renderUpload();
    const btn = screen.getByRole("button", { name: /지금은 건너뛰고 AI 연결하기/ });
    fireEvent.click(btn);
    expect(props.moveToAiConnection).toHaveBeenCalled();
  });

  it("shows matched counts for files", () => {
    const file = makeFile({ matchedCounts: { Observation: 3, Condition: 2 } });
    renderUpload({ visibleFiles: [file] });
    expect(screen.getByText(/Observation 3건/)).toBeInTheDocument();
    expect(screen.getByText(/Condition 2건/)).toBeInTheDocument();
  });

  it("shows no recognized items message when matchedCounts is empty", () => {
    const file = makeFile({ matchedCounts: {} });
    renderUpload({ visibleFiles: [file] });
    expect(screen.getByText(/아직 인식된 항목이 없습니다/)).toBeInTheDocument();
  });

  it("PDF button sets accept to document types and clicks input", () => {
    const { container } = renderUpload();
    const input = container.querySelector("input[type='file']") as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click").mockImplementation(() => {});

    fireEvent.click(screen.getByRole("button", { name: "PDF/문서 선택" }));

    expect(input.accept).toContain(".pdf");
    expect(input.accept).not.toContain("image/jpeg");
    expect(clickSpy).toHaveBeenCalled();
  });

  it("image button sets accept to image types and clicks input", () => {
    const { container } = renderUpload();
    const input = container.querySelector("input[type='file']") as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click").mockImplementation(() => {});

    fireEvent.click(screen.getByRole("button", { name: "사진 선택" }));

    expect(input.accept).toContain("image/jpeg");
    expect(input.accept).not.toContain(".pdf");
    expect(clickSpy).toHaveBeenCalled();
  });

  it("all button sets accept to all types and clicks input", () => {
    const { container } = renderUpload();
    const input = container.querySelector("input[type='file']") as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click").mockImplementation(() => {});

    fireEvent.click(screen.getByRole("button", { name: "전체 형식" }));

    expect(input.accept).toContain(".pdf");
    expect(input.accept).toContain("image/jpeg");
    expect(clickSpy).toHaveBeenCalled();
  });

  it("handles drag over event", () => {
    const { container } = renderUpload();
    const dropZone = container.querySelector("[class*='border-dashed']") as HTMLElement;
    expect(dropZone).toBeTruthy();

    fireEvent.dragOver(dropZone, { preventDefault: () => {} });
    // Should activate drag state (border changes)
    expect(dropZone.className).toContain("border-primary");
  });

  it("handles drag leave event", () => {
    const { container } = renderUpload();
    const dropZone = container.querySelector("[class*='border-dashed']") as HTMLElement;

    fireEvent.dragOver(dropZone, { preventDefault: () => {} });
    fireEvent.dragLeave(dropZone, { preventDefault: () => {} });

    // Should deactivate drag state
    expect(dropZone.className).not.toContain("bg-primary/10");
  });

  it("handles drop event and calls uploadFiles", () => {
    const { props, container } = renderUpload();
    const dropZone = container.querySelector("[class*='border-dashed']") as HTMLElement;

    const file = new File(["test"], "dropped.pdf", { type: "application/pdf" });
    const dataTransfer = { files: [file] as unknown as FileList };

    fireEvent.drop(dropZone, { preventDefault: () => {}, dataTransfer });

    expect(props.uploadFiles).toHaveBeenCalled();
  });

  it("calls uploadFiles via file input onChange", () => {
    const ref = React.createRef<HTMLInputElement>();
    const { props, container } = renderUpload({ fileInputRef: ref });
    const input = container.querySelector("input[type='file']") as HTMLInputElement;
    expect(input).toBeTruthy();

    fireEvent.change(input, { target: { files: [new File(["test"], "test.pdf")] } });
    expect(props.uploadFiles).toHaveBeenCalled();
  });
});
