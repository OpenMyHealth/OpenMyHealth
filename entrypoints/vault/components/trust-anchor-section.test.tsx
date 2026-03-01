// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { TrustAnchorSection } from "./trust-anchor-section";

describe("TrustAnchorSection", () => {
  it("renders trust anchor cards", () => {
    render(<TrustAnchorSection />);
    expect(screen.getByText("클라우드 전송 없음")).toBeInTheDocument();
    expect(screen.getByText("AES-256 암호화")).toBeInTheDocument();
    expect(screen.getByText("수집 정보 없음")).toBeInTheDocument();
    expect(screen.getByText("오픈소스 검증")).toBeInTheDocument();
  });

  it("GitHub link is present and correct", () => {
    render(<TrustAnchorSection />);
    const link = screen.getByRole("link", { name: "저장소 보기" });
    expect(link).toHaveAttribute("href", "https://github.com/openmyhealth/openmyhealth");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("renders all 4 card articles", () => {
    render(<TrustAnchorSection />);
    const articles = screen.getAllByRole("article");
    expect(articles).toHaveLength(4);
  });

  it("icons are marked as aria-hidden", () => {
    const { container } = render(<TrustAnchorSection />);
    const icons = container.querySelectorAll("[aria-hidden='true']");
    expect(icons.length).toBeGreaterThanOrEqual(4);
  });
});
