import {
  Prescriptions,
  TreatmentsDetail,
  TreatmentsSummary,
} from "../context/types";

function parseNumeric(value: string): number {
  const normalized = value.replace(/,/g, "").trim();
  if (!normalized) return 0;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function textFromCell(cell: Element | undefined): string {
  if (!cell) return "";
  const explicit = cell.querySelector("span:not(.phide)");
  return (explicit?.textContent ?? cell.textContent ?? "").trim();
}

export function parseTreatmentsSummary(html: string): TreatmentsSummary[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const rows = [...doc.querySelectorAll("#dynamicTbody tr")];

  return rows
    .map((row) => {
      const cells = [...row.querySelectorAll("td")];
      return {
        date: textFromCell(cells[0]),
        hospital: textFromCell(cells[1]),
        part: textFromCell(cells[2]),
        type: textFromCell(cells[3]),
        code: textFromCell(cells[4]),
        disease_name: textFromCell(cells[5]),
        days: parseNumeric(textFromCell(cells[6])),
        total_fee: parseNumeric(textFromCell(cells[7])),
        insurance_fee: parseNumeric(textFromCell(cells[8])),
        my_fee: parseNumeric(textFromCell(cells[9])),
      };
    })
    .filter((item) => !item.hospital.includes("약국"));
}

export function parseTreatmentsDetail(html: string): TreatmentsDetail[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const rows = [...doc.querySelectorAll(".tbl_data tbody tr")];

  return rows.map((row) => {
    const cells = [...row.querySelectorAll("td")];
    return {
      date: textFromCell(cells[0]),
      hospital: textFromCell(cells[1]),
      category: textFromCell(cells[2]),
      name: textFromCell(cells[3]),
      amount: parseNumeric(textFromCell(cells[4])),
      frequency: parseNumeric(textFromCell(cells[5])),
      days: parseNumeric(textFromCell(cells[6])),
    };
  });
}

export function parsePrescriptions(html: string): Prescriptions[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const rows = [...doc.querySelectorAll(".tbl_data tbody tr")];

  return rows.map((row) => {
    const cells = [...row.querySelectorAll("td")];
    return {
      date: textFromCell(cells[0]),
      hospital: textFromCell(cells[1]),
      medicine_name: textFromCell(cells[3]),
      ingredient: textFromCell(cells[4]),
      amount: parseNumeric(textFromCell(cells[5])),
      frequency: parseNumeric(textFromCell(cells[6])),
      days: parseNumeric(textFromCell(cells[7])),
    };
  });
}
