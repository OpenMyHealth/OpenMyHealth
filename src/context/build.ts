import dayjs from "dayjs";
import { ContextPacketV1, OpenChartRecord } from "./types";

const SAFETY_NOTE =
  "이 초안은 의료정보 정리를 돕기 위한 참고용입니다. 진단/치료 결정은 반드시 의료진과 상의하세요.";

export interface DraftBuildOptions {
  maxChars?: number;
  minTimelineItems?: number;
  minEvidenceItems?: number;
  minMedicationItems?: number;
}

function getConfidenceLabel(records: OpenChartRecord[]): ContextPacketV1["confidenceLabel"] {
  if (records.length >= 30) return "high";
  if (records.length >= 8) return "medium";
  return "low";
}

function buildClinicalSummary(records: OpenChartRecord[]) {
  if (!records.length) {
    return "현재 연동된 진료기록이 없어 일반 질문 모드로 답변을 요청합니다.";
  }

  const latest = records.slice(0, 5);
  const diseaseLine = latest
    .map((record) => `${record.diagnosisName}(${dayjs(record.date).format("YYYY-MM-DD")})`)
    .join(", ");

  return [
    `최근 주요 진료 기록은 ${diseaseLine} 입니다.`,
    `최근 ${latest.length}건 기준으로 의료기관은 ${[
      ...new Set(latest.map((record) => record.hospital)),
    ].join(", ")} 입니다.`,
    "질문에 답할 때 아래 타임라인과 복약 정보를 우선 참고해 주세요.",
  ].join(" ");
}

function buildTimeline(records: OpenChartRecord[]): ContextPacketV1["timeline"] {
  return records.slice(0, 6).map((record) => ({
    period: dayjs(record.date).format("YYYY-MM-DD"),
    keyEvents: [
      `${record.hospital} ${record.department}`,
      `${record.diagnosisName}`,
      `총진료비 ${record.fees?.total?.toLocaleString() ?? "-"}원`,
    ],
  }));
}

function buildMedications(records: OpenChartRecord[]) {
  return [
    ...new Set(
      records
        .flatMap((record) => record.prescriptions)
        .map((prescription) => prescription.name)
        .filter(Boolean),
    ),
  ].slice(0, 20);
}

function buildRedFlags(records: OpenChartRecord[]) {
  const flags = new Set<string>();
  for (const record of records) {
    if ((record.diagnosisCode ?? "").startsWith("AC")) {
      flags.add("암 관련 코드(AC*) 기록이 포함되어 있습니다.");
    }
    if ((record.fees?.total ?? 0) >= 1_000_000) {
      flags.add("고비용 진료 기록(100만원 이상)이 포함되어 있습니다.");
    }
    if (record.prescriptions.length >= 5) {
      flags.add("동일 진료일 다약제 처방 기록이 있습니다.");
    }
  }
  return [...flags];
}

function buildEvidence(records: OpenChartRecord[]): ContextPacketV1["evidence"] {
  return records.slice(0, 8).map((record) => ({
    recordId: record.id,
    snippet: `${dayjs(record.date).format("YYYY-MM-DD")} ${record.hospital} ${record.diagnosisName}`,
  }));
}

function renderDraft(packet: ContextPacketV1) {
  const timelineLines = packet.timeline
    .map((item) => `- ${item.period}: ${item.keyEvents.join(" | ")}`)
    .join("\n");
  const medicationLines =
    packet.medications.length > 0
      ? packet.medications.map((name) => `- ${name}`).join("\n")
      : "- 복약 기록 없음";
  const redFlagLines =
    packet.redFlags.length > 0
      ? packet.redFlags.map((flag) => `- ${flag}`).join("\n")
      : "- 특이 위험 신호 없음";
  const evidenceLines = packet.evidence
    .map((item) => `- ${item.recordId}: ${item.snippet}`)
    .join("\n");

  return [
    "의료기록 컨텍스트를 참고해서 답변해 주세요.",
    "",
    `질문: ${packet.userQuestion}`,
    `신뢰도 라벨: ${packet.confidenceLabel}`,
    "",
    `[요약] ${packet.clinicalSummary}`,
    "",
    "[타임라인]",
    timelineLines,
    "",
    "[복약]",
    medicationLines,
    "",
    "[레드플래그]",
    redFlagLines,
    "",
    "[근거]",
    evidenceLines,
    "",
    `[안전고지] ${packet.safetyNote}`,
  ].join("\n");
}

function renderUltraCompactDraft(packet: ContextPacketV1, maxChars: number) {
  let summary = packet.clinicalSummary;
  let evidence = [...packet.evidence];

  while (summary.length > 80) {
    const draft = [
      `질문: ${packet.userQuestion.slice(0, 80)}`,
      `요약: ${summary}`,
      "근거:",
      ...evidence.map((item) => `- ${item.recordId}: ${item.snippet.slice(0, 60)}`),
      `안전고지: ${packet.safetyNote}`,
    ].join("\n");

    if (draft.length <= maxChars) {
      return draft;
    }

    if (evidence.length > 1) {
      evidence.pop();
      continue;
    }

    summary = `${summary.slice(0, summary.length - 20)}...`;
  }

  return [
    `질문: ${packet.userQuestion.slice(0, 60)}`,
    `요약: ${summary.slice(0, 80)}`,
    `근거: ${evidence[0]?.snippet.slice(0, 60) ?? "없음"}`,
    `안전고지: ${packet.safetyNote}`,
  ].join("\n").slice(0, maxChars);
}

export function buildContextPacket(
  userQuestion: string,
  records: OpenChartRecord[],
): ContextPacketV1 {
  return {
    userQuestion,
    clinicalSummary: buildClinicalSummary(records),
    timeline: buildTimeline(records),
    medications: buildMedications(records),
    redFlags: buildRedFlags(records),
    evidence: buildEvidence(records),
    safetyNote: SAFETY_NOTE,
    confidenceLabel: getConfidenceLabel(records),
  };
}

function compactPacket(
  source: ContextPacketV1,
  options: Required<DraftBuildOptions>,
): ContextPacketV1 {
  const packet: ContextPacketV1 = {
    ...source,
    timeline: [...source.timeline],
    medications: [...source.medications],
    redFlags: [...source.redFlags],
    evidence: [...source.evidence],
  };

  let draft = renderDraft(packet);

  while (draft.length > options.maxChars) {
    if (packet.evidence.length > options.minEvidenceItems) {
      packet.evidence.pop();
    } else if (packet.timeline.length > options.minTimelineItems) {
      packet.timeline.pop();
    } else if (packet.medications.length > options.minMedicationItems) {
      packet.medications.pop();
    } else if (packet.clinicalSummary.length > 120) {
      packet.clinicalSummary = `${packet.clinicalSummary.slice(0, 117)}...`;
    } else {
      break;
    }

    draft = renderDraft(packet);
  }

  return packet;
}

export function buildProviderDraft(
  packet: ContextPacketV1,
  options: DraftBuildOptions = {},
) {
  const normalized: Required<DraftBuildOptions> = {
    maxChars: options.maxChars ?? 3500,
    minTimelineItems: options.minTimelineItems ?? 3,
    minEvidenceItems: options.minEvidenceItems ?? 3,
    minMedicationItems: options.minMedicationItems ?? 4,
  };

  const compacted = compactPacket(packet, normalized);
  const draft = renderDraft(compacted);

  if (draft.length <= normalized.maxChars) {
    return draft;
  }

  return renderUltraCompactDraft(compacted, normalized.maxChars);
}
