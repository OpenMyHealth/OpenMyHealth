vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: vi.fn(),
}));
vi.mock("pdfjs-dist/legacy/build/pdf.worker.mjs?url", () => ({
  default: "mock-worker-url",
}));

import { parseUploadPipeline } from "./pipeline";

const encode = (text: string) => new TextEncoder().encode(text);

describe("classify — text files with keywords", () => {
  it("text file with lab keywords classifies as Observation", async () => {
    const result = await parseUploadPipeline("labs.txt", "text/plain", encode("Hemoglobin: 14.5 g/dL"));
    expect(result.matchedCounts.Observation).toBe(1);
  });

  it("text file with medication keywords classifies as MedicationStatement", async () => {
    const result = await parseUploadPipeline("meds.txt", "text/plain", encode("Aspirin 500 mg daily"));
    expect(result.matchedCounts.MedicationStatement).toBe(1);
  });

  it("text file with condition keywords classifies as Condition", async () => {
    const result = await parseUploadPipeline("diag.txt", "text/plain", encode("진단: stage II cancer 병기"));
    expect(result.matchedCounts.Condition).toBe(1);
  });

  it("text file with report keywords classifies as DiagnosticReport", async () => {
    const result = await parseUploadPipeline("report.txt", "text/plain", encode("MRI report 소견: normal"));
    expect(result.matchedCounts.DiagnosticReport).toBe(1);
  });

  it("text file with no matching keywords classifies as DocumentReference", async () => {
    const result = await parseUploadPipeline("notes.txt", "text/plain", encode("random text without any medical terms"));
    expect(result.matchedCounts.DocumentReference).toBe(1);
  });

  it("text file with mixed keywords results in multiple resource types", async () => {
    const text = "Hemoglobin: 14.5 g/dL\nAspirin 500 mg\n진단: cancer";
    const result = await parseUploadPipeline("mixed.txt", "text/plain", encode(text));
    expect(result.matchedCounts.Observation).toBe(1);
    expect(result.matchedCounts.MedicationStatement).toBe(1);
    expect(result.matchedCounts.Condition).toBe(1);
  });
});

describe("parseObservations", () => {
  it("extracts 'Hemoglobin: 14.5 g/dL' format", async () => {
    const text = "Hemoglobin: 14.5 g/dL\nPlatelet: 250 K/uL";
    const result = await parseUploadPipeline("lab.txt", "text/plain", encode(text));

    // The Observation resources should contain parsed data records
    const obsResources = result.resources.filter((r) => r.resourceType === "Observation");
    expect(obsResources.length).toBe(2);
    const hemoglobin = obsResources.find((r) => r.payload.display === "Hemoglobin");
    expect(hemoglobin).toBeDefined();
    expect(hemoglobin!.payload.value).toBe(14.5);
    expect(hemoglobin!.payload.unit).toBe("g/dL");
  });

  it("extracts with Korean labels", async () => {
    const text = "혈색소: 12.3 g/dL\n혈소판: 180 K/uL";
    const result = await parseUploadPipeline("korean-lab.txt", "text/plain", encode(text));

    const obsResources = result.resources.filter((r) => r.resourceType === "Observation");
    expect(obsResources.length).toBe(2);
    const hemoglobin = obsResources.find((r) => r.payload.display === "혈색소");
    expect(hemoglobin).toBeDefined();
    expect(hemoglobin!.payload.value).toBe(12.3);
  });

  it("stops at 10 results (limit check)", async () => {
    const lines = Array.from({ length: 15 }, (_, i) => `Test${i}: ${i + 1} mg/dL`).join("\n");
    const result = await parseUploadPipeline("many-labs.txt", "text/plain", encode(lines));

    const obsResources = result.resources.filter((r) => r.resourceType === "Observation");
    expect(obsResources.length).toBeLessThanOrEqual(10);
  });

  it("caps observations at exactly 10 results", async () => {
    const labels = ["Hemoglobin", "Platelet", "WBC", "RBC", "Glucose", "Albumin", "Calcium", "Sodium", "Potassium", "Chloride", "Magnesium", "Iron"];
    const lines = labels.map((label, i) => `${label}: ${i + 1} mg/dL`).join("\n");
    const result = await parseUploadPipeline("many-labs.txt", "text/plain", encode(lines));

    const obsResources = result.resources.filter((r) => r.resourceType === "Observation");
    expect(obsResources.length).toBe(10);
  });

  it("only extracts well-formed finite numbers from digit patterns", async () => {
    // The regex captures digit patterns like "14.5", so Number() always returns
    // a finite value. This test verifies that all extracted observation values
    // are finite numbers and that the parser correctly handles label:value format.
    const text = "Lab검사: 14.5 g/dL\nGlucose: 99 mg/dL\nResult검사: 7.2 mmol/L";
    const result = await parseUploadPipeline("lab.txt", "text/plain", encode(text));
    const obsResources = result.resources.filter((r) => r.resourceType === "Observation");
    expect(obsResources.length).toBe(3);
    for (const r of obsResources) {
      expect(typeof r.payload.value).toBe("number");
      expect(Number.isFinite(r.payload.value)).toBe(true);
    }
  });
});

describe("parseMedications", () => {
  it("extracts 'Aspirin 500 mg' format", async () => {
    const text = "처방: Aspirin 500 mg twice daily";
    const result = await parseUploadPipeline("rx.txt", "text/plain", encode(text));

    const medResources = result.resources.filter((r) => r.resourceType === "MedicationStatement");
    expect(medResources.length).toBe(1);
    const aspirin = medResources.find((r) => r.payload.display === "Aspirin");
    expect(aspirin).toBeDefined();
    expect(aspirin!.payload.value).toBe(500);
    expect(aspirin!.payload.unit).toBe("mg");
  });

  it("extracts with Korean units (정, 캡슐)", async () => {
    const text = "약: 타이레놀 500 정 복용";
    const result = await parseUploadPipeline("korean-rx.txt", "text/plain", encode(text));

    const medResources = result.resources.filter((r) => r.resourceType === "MedicationStatement");
    expect(medResources.length).toBe(1);
    const found = medResources.find((r) => r.payload.unit === "정");
    expect(found).toBeDefined();
    expect(found!.payload.value).toBe(500);
  });

  it("caps medications at exactly 10 results", async () => {
    // Use ; separator to prevent regex spanning across entries (regex char class includes \s)
    const entries = Array.from({ length: 15 }, (_, i) => `Med${i} ${(i + 1) * 100} mg`);
    const text = `처방전; ${entries.join("; ")}`;
    const result = await parseUploadPipeline("many-rx.txt", "text/plain", encode(text));

    const medResources = result.resources.filter((r) => r.resourceType === "MedicationStatement");
    expect(medResources.length).toBe(10);
  });
});

describe("file type handling", () => {
  it("CSV file (text/csv) is handled as text", async () => {
    const csv = "name,value\nHemoglobin,14.5";
    const result = await parseUploadPipeline("data.csv", "text/csv", encode(csv));
    expect(result.preview).toBeTruthy();
    expect(result.resources.length).toBe(1);
  });

  it("JSON file is handled as text", async () => {
    const json = '{"test": "lab data", "Hemoglobin": 14.5}';
    const result = await parseUploadPipeline("data.json", "application/json", encode(json));
    expect(result.preview).toBeTruthy();
  });

  it("XML file is handled as text", async () => {
    const xml = "<report><test>lab data</test></report>";
    const result = await parseUploadPipeline("data.xml", "application/xml", encode(xml));
    expect(result.preview).toBeTruthy();
  });
});

describe("image files", () => {
  it("image/jpeg returns DocumentReference, no text parsing", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const result = await parseUploadPipeline("photo.jpg", "image/jpeg", bytes);
    expect(result.matchedCounts.DocumentReference).toBe(1);
    expect(result.resources[0].resourceType).toBe("DocumentReference");
  });

  it("by extension (.png) returns DocumentReference", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const result = await parseUploadPipeline("scan.png", "application/octet-stream", bytes);
    expect(result.matchedCounts.DocumentReference).toBe(1);
  });
});

describe("error handling", () => {
  it("unsupported format (application/zip) throws 'unsupported_upload_format'", async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    await expect(parseUploadPipeline("archive.zip", "application/zip", bytes)).rejects.toThrow(
      "unsupported_upload_format",
    );
  });

  it("empty text file throws 'empty_extracted_text'", async () => {
    await expect(parseUploadPipeline("empty.txt", "text/plain", encode(""))).rejects.toThrow("empty_extracted_text");
  });
});

describe("PDF handling", () => {
  it("PDF file calls extractPdfText (mock pdfjs)", async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const mockPage = {
      getTextContent: vi.fn().mockResolvedValue({
        items: [{ str: "Lab" }, { str: " Results: Hemoglobin 14.5" }],
      }),
    };
    const mockDocument = {
      numPages: 1,
      getPage: vi.fn().mockResolvedValue(mockPage),
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    const mockLoadingTask = {
      promise: Promise.resolve(mockDocument),
    };
    vi.mocked(pdfjs.getDocument).mockReturnValue(mockLoadingTask as never);

    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const result = await parseUploadPipeline("test.pdf", "application/pdf", bytes);

    expect(pdfjs.getDocument).toHaveBeenCalled();
    expect(result.preview).toContain("Lab");
    expect(result.resources.length).toBe(1);
  });
});

describe("text preview", () => {
  it("is limited to 400 chars", async () => {
    const longText = "A".repeat(1000) + " lab report";
    const result = await parseUploadPipeline("long.txt", "text/plain", encode(longText));
    expect(result.preview.length).toBeLessThanOrEqual(400);
  });
});
