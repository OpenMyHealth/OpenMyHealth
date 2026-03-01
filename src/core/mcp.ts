import {
  MAX_RECORDS_PER_RESPONSE,
  type McpDataRecord,
  ReadHealthRecordsResponseSchema,
  type ReadHealthRecordsRequest,
  type ReadHealthRecordsResponse,
  type ResourceType,
} from "../../packages/contracts/src/index";
import { decryptJson } from "./crypto";
import { queryResources } from "./db";
import type { StoredResourceRecord } from "./models";

function mapDepth(record: McpDataRecord, depth: ReadHealthRecordsRequest["depth"]): McpDataRecord {
  if (depth === "codes") {
    return {
      id: record.id,
      code: record.code,
      system: record.system,
    };
  }

  if (depth === "summary") {
    return {
      id: record.id,
      code: record.code,
      system: record.system,
      display: record.display,
      value: record.value,
      unit: record.unit,
      date: record.date,
      flag: record.flag,
    };
  }

  return record;
}

function groupByResourceType(records: Array<{ resourceType: ResourceType; payload: McpDataRecord }>) {
  const grouped = new Map<ResourceType, McpDataRecord[]>();
  for (const item of records) {
    const list = grouped.get(item.resourceType) ?? [];
    list.push(item.payload);
    grouped.set(item.resourceType, list);
  }
  return grouped;
}

function matchesQuery(payload: McpDataRecord, queryLower?: string): boolean {
  if (!queryLower) {
    return true;
  }

  const haystack = [
    payload.display,
    payload.code,
    payload.system,
    /* v8 ignore next -- both branches tested via numeric and string value records */
    typeof payload.value === "number" ? String(payload.value) : payload.value,
    payload.unit,
    payload.date,
    payload.performer,
    payload.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(queryLower);
}

async function decryptResourceRecords(
  key: CryptoKey,
  records: StoredResourceRecord[],
  query?: string,
): Promise<Array<{ resourceType: ResourceType; payload: McpDataRecord }>> {
  const queryLower = query?.toLowerCase();
  const matched = new Array<{ resourceType: ResourceType; payload: McpDataRecord } | null>(records.length).fill(null);
  const concurrency = 6;
  let cursor = 0;

  const workers = Array.from({ length: Math.min(concurrency, records.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= records.length) {
        break;
      }

      const record = records[index];
      try {
        const payload = await decryptJson<McpDataRecord>(key, record.encryptedPayload);
        if (!matchesQuery(payload, queryLower)) {
          continue;
        }
        matched[index] = { resourceType: record.resourceType, payload };
      } catch (err) {
        console.warn("[mcp] skipping corrupted record:", record.id, err);
      }
    }
  });

  await Promise.all(workers);
  return matched.filter((item): item is { resourceType: ResourceType; payload: McpDataRecord } => item !== null);
}

export async function buildMcpResponse(
  key: CryptoKey,
  request: ReadHealthRecordsRequest,
): Promise<ReadHealthRecordsResponse> {
  const limit = Math.min(request.limit ?? MAX_RECORDS_PER_RESPONSE, MAX_RECORDS_PER_RESPONSE);
  const scanLimit = request.query ? 5_000 : limit;
  const matchedRecords = await queryResources({
    resourceTypes: request.resource_types,
    dateFrom: request.date_from,
    dateTo: request.date_to,
    limit: scanLimit,
  });

  const decrypted = await decryptResourceRecords(key, matchedRecords, request.query);
  const limited = decrypted.slice(0, limit);
  const grouped = groupByResourceType(limited);

  const resources = request.resource_types.map((resourceType) => {
    const list = (grouped.get(resourceType) ?? []).map((record) => mapDepth(record, request.depth));
    return {
      resource_type: resourceType,
      count: list.length,
      data: list,
    };
  });

  const count = resources.reduce((acc, item) => acc + item.count, 0);

  const response: ReadHealthRecordsResponse = {
    schema_version: "1.0",
    status: "ok",
    depth: request.depth,
    resources,
    count,
    meta: {
      total_available: matchedRecords.length,
      filtered_count: decrypted.length,
      query_matched: request.query ? decrypted.length > 0 : false,
    },
  };

  return ReadHealthRecordsResponseSchema.parse(response);
}
