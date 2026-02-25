import type { NormalizedRecord, RawSourceRecord, SourceAdapter } from "../types";

/**
 * Country/source adapter template.
 * Copy this file into `src/shared/adapters/<countrySource>.ts` and implement each method.
 */
export const adapterTemplate: SourceAdapter = {
  id: "xx-source",
  country: "XX",
  name: "Example National PHR",
  description: "Describe what data this source can provide.",
  entryUrl: "https://example.gov/health",
  match: [/^https:\/\/example\.gov\//i],
  guideSteps: [
    {
      id: "auth",
      title: "Authenticate",
      description: "User signs in on the official source website.",
      selector: "#login",
    },
    {
      id: "view-records",
      title: "Open records page",
      description: "Navigate to the page that lists patient records.",
      selector: "table",
    },
    {
      id: "capture",
      title: "Capture into Vault",
      description: "Use OpenMyHealth side panel capture button.",
      optional: true,
    },
  ],
  detectStepState(document: Document): Record<string, boolean> {
    return {
      auth: Boolean(document.querySelector("#logout")),
      "view-records": document.querySelectorAll("table tbody tr").length > 0,
      capture: false,
    };
  },
  parseRawRecords(_document: Document): RawSourceRecord[] {
    // 1) Parse the source page into raw records.
    // 2) Keep all source-specific fields in payload so they can be audited later.
    return [];
  },
  normalize(_records: RawSourceRecord[]): NormalizedRecord[] {
    // Convert raw records to normalized records + FHIR resources.
    return [];
  },
};
