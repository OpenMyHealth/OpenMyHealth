import { cn } from "./utils";

describe("cn", () => {
  it("passes through a single class", () => {
    expect(cn("p-4")).toBe("p-4");
  });

  it("merges multiple classes", () => {
    expect(cn("font-bold", "text-center")).toBe("font-bold text-center");
  });

  it("ignores falsy values", () => {
    expect(cn("p-4", false, null, undefined, "", "m-2")).toBe("p-4 m-2");
  });

  it("resolves Tailwind conflicts (last wins)", () => {
    expect(cn("p-4", "p-8")).toBe("p-8");
  });

  it("resolves conflicting text colors", () => {
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("handles conditional object syntax via clsx", () => {
    expect(cn({ "font-bold": true, "italic": false }, "underline")).toBe(
      "font-bold underline",
    );
  });

  it("returns empty string for no arguments", () => {
    expect(cn()).toBe("");
  });
});
