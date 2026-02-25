import type { ApprovalPreview, NormalizedRecord } from "../types";
import { redactSensitiveText } from "./redact";

function sectionLabel(type: NormalizedRecord["type"]): string {
  switch (type) {
    case "condition":
      return "진단";
    case "medication":
      return "처방";
    case "procedure":
      return "시술/검사";
    case "claim":
      return "청구";
    case "observation":
      return "관찰";
    default:
      return "기록";
  }
}

export function buildApprovalPreview(query: string, records: NormalizedRecord[]): ApprovalPreview {
  const lines: string[] = [];
  lines.push("[OpenMyHealth Approved Context]");
  lines.push(`질문: ${query}`);
  lines.push("아래는 사용자가 명시적으로 승인한 최소 의료 컨텍스트입니다.");

  let redactionCount = 0;
  for (const record of records) {
    const section = sectionLabel(record.type);
    const chunk = `${section} | ${record.date} | ${record.sourceName} | ${record.title}\n${record.summary}`;
    const redacted = redactSensitiveText(chunk);
    redactionCount += redacted.count;
    lines.push("---");
    lines.push(redacted.text);
  }

  lines.push("---");
  lines.push("개인식별정보는 전달 전에 자동 마스킹되었습니다.");

  return {
    ids: records.map((record) => record.id),
    query,
    contextText: lines.join("\n"),
    redactionCount,
  };
}
