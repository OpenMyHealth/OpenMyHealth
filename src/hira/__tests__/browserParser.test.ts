import {
  parsePrescriptions,
  parseTreatmentsDetail,
  parseTreatmentsSummary,
} from "../browserParser";

describe("browser HIRA parser", () => {
  it("요약 테이블을 파싱하고 약국 항목을 제외한다", () => {
    const html = `
      <table><tbody id="dynamicTbody">
        <tr>
          <td><span>2025-01-01</span></td><td><span>서울병원</span></td>
          <td><span>내과</span></td><td><span>외래</span></td>
          <td><span>A123</span></td><td><span>고혈압</span></td>
          <td><span>3</span></td><td><span>30,000</span></td>
          <td><span>20,000</span></td><td><span>10,000</span></td>
        </tr>
        <tr>
          <td><span>2025-01-02</span></td><td><span>동네약국</span></td>
          <td><span>-</span></td><td><span>-</span></td>
          <td><span>-</span></td><td><span>-</span></td>
          <td><span>1</span></td><td><span>1,000</span></td>
          <td><span>500</span></td><td><span>500</span></td>
        </tr>
      </tbody></table>
    `;

    const rows = parseTreatmentsSummary(html);
    expect(rows).toHaveLength(1);
    expect(rows[0].hospital).toBe("서울병원");
    expect(rows[0].total_fee).toBe(30000);
  });

  it("상세/처방 테이블을 파싱한다", () => {
    const html = `
      <table class="tbl_data"><tbody>
        <tr>
          <td><span>2025-01-01</span></td>
          <td><span>서울병원</span></td>
          <td><span>검사</span></td>
          <td><span>혈액검사</span></td>
          <td><span>1</span></td>
          <td><span>1</span></td>
          <td><span>1</span></td>
          <td><span>30</span></td>
        </tr>
      </tbody></table>
    `;

    const detail = parseTreatmentsDetail(html);
    const prescriptions = parsePrescriptions(html);

    expect(detail[0].name).toBe("혈액검사");
    expect(prescriptions[0].medicine_name).toBe("혈액검사");
    expect(prescriptions[0].days).toBe(30);
  });
});
