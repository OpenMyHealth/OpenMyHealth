import {
  BuildContextRequest,
  BuildContextResult,
  Hira5ySubmitResponse,
  Provider,
} from "../context/types";

export type RuntimeMessage =
  | {
      type: "BUILD_CONTEXT_PACKET";
      payload: BuildContextRequest;
    }
  | {
      type: "INSERT_DRAFT_TO_ACTIVE_TAB";
      payload: {
        provider: Provider;
        draft: string;
      };
    };

export type RuntimeResponse =
  | {
      ok: true;
      data: BuildContextResult | { delivered: boolean };
    }
  | {
      ok: false;
      error: string;
    };

export function isHiraPayload(payload: unknown): payload is Hira5ySubmitResponse {
  if (!payload || typeof payload !== "object") return false;
  const value = payload as Partial<Hira5ySubmitResponse>;
  return (
    Array.isArray(value.treatmentsSummary) &&
    Array.isArray(value.treatmentsDetail) &&
    Array.isArray(value.prescriptions)
  );
}
