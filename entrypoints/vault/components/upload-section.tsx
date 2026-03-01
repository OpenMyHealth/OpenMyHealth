import React from "react";
import type { ResourceType } from "../../../packages/contracts/src/index";
import type { VaultFileSummary } from "../../../src/core/models";
import { fileStatusLabel, resourceLabel } from "../../../src/core/utils";

type UploadSectionProps = {
  hasFiles: boolean;
  uploading: boolean;
  isBusy: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  uploadFiles: (files: FileList | null) => Promise<void>;
  moveToAiConnection: () => void;
  visibleFiles: VaultFileSummary[];
  statusTone: (status: VaultFileSummary["status"]) => string;
  triggerDownload: (fileId: string) => Promise<void>;
  triggerDelete: (fileId: string) => Promise<void>;
};

export function UploadSection({
  hasFiles,
  uploading,
  isBusy,
  fileInputRef,
  uploadFiles,
  moveToAiConnection,
  visibleFiles,
  statusTone,
  triggerDownload,
  triggerDelete,
}: UploadSectionProps): React.ReactElement {
  const [dragActive, setDragActive] = React.useState(false);
  const uploadExamples = [
    { title: "혈액검사 결과지", hint: "CBC, 간수치, 종양표지자" },
    { title: "처방전", hint: "복용약 이름, 용량, 기간" },
    { title: "건강검진 결과", hint: "검진 요약, 이상 소견" },
  ] as const;

  function openPicker(mode: "pdf" | "image" | "all"): void {
    if (!fileInputRef.current) {
      return;
    }
    if (mode === "pdf") {
      fileInputRef.current.accept = ".pdf,.txt,.text,.json,.xml,.csv";
    } else if (mode === "image") {
      fileInputRef.current.accept = ".heic,.heif,image/jpeg,image/png,image/heic,image/heif";
    } else {
      fileInputRef.current.accept = ".pdf,.txt,.text,.json,.xml,.csv,.heic,.heif,image/jpeg,image/png,image/heic,image/heif";
    }
    fileInputRef.current.click();
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragActive(false);
    void uploadFiles(event.dataTransfer.files);
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <h2 className="text-xl font-semibold">건강 기록 업로드</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        1장만 올려보세요. 업로드한 파일은 로컬에서 분류/암호화 후 저장됩니다.
      </p>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        {uploadExamples.map((example) => (
          <article key={example.title} className="rounded-lg border border-border bg-secondary/45 px-3 py-3">
            <p className="text-sm font-semibold text-foreground">{example.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{example.hint}</p>
          </article>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span className="rounded-full border border-border bg-secondary px-2 py-0.5">지원 형식: PDF, TXT, CSV, JSON, XML, JPEG, PNG, HEIC</span>
        <span className="rounded-full border border-info/35 bg-info/10 px-2 py-0.5 text-info">사진은 우선 안전 보관 후 요약 정보로 표시됩니다</span>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="sr-only"
        multiple
        accept=".pdf,.txt,.text,.json,.xml,.csv,.heic,.heif,image/jpeg,image/png,image/heic,image/heif"
        onChange={(event) => void uploadFiles(event.target.files)}
      />

      <div
        className={`mt-4 w-full rounded-2xl border border-dashed p-6 text-left transition disabled:opacity-60 ${
          dragActive
            ? "border-primary bg-primary/10"
            : "border-primary/45 bg-[radial-gradient(circle_at_top_left,hsl(var(--accent))_0%,hsl(var(--card))_58%)] hover:border-primary hover:bg-secondary/30"
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragActive(false);
        }}
        onDrop={handleDrop}
      >
        <div className="text-sm font-semibold text-primary">{uploading ? "업로드 처리 중..." : "파일 선택"}</div>
        <div className="mt-1 text-sm text-muted-foreground">
          처음에는 PDF 1장을 추천해요. 문서는 자동 분류되고, 사진은 안전 보관 카드로 추가됩니다. 드래그 앤 드롭도 지원합니다. (최대 30MB)
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="min-h-[48px] rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            onClick={() => openPicker("pdf")}
            disabled={isBusy}
          >
            PDF/문서 선택
          </button>
          <button
            type="button"
            className="min-h-[48px] rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground disabled:opacity-60"
            onClick={() => openPicker("image")}
            disabled={isBusy}
          >
            사진 선택
          </button>
          <button
            type="button"
            className="min-h-[48px] rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground disabled:opacity-60"
            onClick={() => openPicker("all")}
            disabled={isBusy}
          >
            전체 형식
          </button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          className="min-h-[48px] rounded-lg px-2 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          onClick={moveToAiConnection}
          disabled={isBusy}
        >
          지금은 건너뛰고 AI 연결하기
        </button>
        {hasFiles && (
          <button
            type="button"
            className="min-h-[48px] rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            onClick={moveToAiConnection}
            disabled={isBusy}
          >
            업로드 마치고 AI 연결하기 →
          </button>
        )}
      </div>

      <div className="mt-4 grid gap-3" aria-live="polite">
        {visibleFiles.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-secondary/30 px-4 py-6 text-sm text-muted-foreground">
            아직 업로드한 기록이 없습니다. 첫 파일을 올리면 파일별 인식 결과와 다운로드가 여기 표시됩니다.
          </div>
        )}

        {visibleFiles.map((file) => (
          <div key={file.id} className="rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{file.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {new Date(file.createdAt).toLocaleString()} · {(file.size / 1024 / 1024).toFixed(2)}MB
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-1 text-sm font-semibold ${statusTone(file.status)}`}>
                  {fileStatusLabel(file.status)}
                </span>
                {file.status === "done" && (
                  <>
                    <button
                      type="button"
                      className="min-h-[48px] rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground hover:bg-secondary"
                      aria-label={`${file.name} 다운로드`}
                      onClick={() => void triggerDownload(file.id)}
                    >
                      다운로드
                    </button>
                    <button
                      type="button"
                      className="min-h-[48px] rounded-lg px-2 py-2 text-sm text-muted-foreground hover:text-destructive"
                      aria-label={`${file.name} 삭제`}
                      onClick={() => void triggerDelete(file.id)}
                    >
                      삭제
                    </button>
                  </>
                )}
                {file.status === "error" && (
                  <button
                    type="button"
                    className="min-h-[48px] rounded-lg border border-destructive/40 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
                    aria-label={`${file.name} 삭제`}
                    onClick={() => void triggerDelete(file.id)}
                  >
                    삭제
                  </button>
                )}
              </div>
            </div>

            <p className="mt-2 text-sm text-muted-foreground">
              {Object.entries(file.matchedCounts ?? {})
                .map(([type, count]) => `${resourceLabel(type as ResourceType)} ${count}건`)
                .join(" • ") || "아직 인식된 항목이 없습니다"}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
