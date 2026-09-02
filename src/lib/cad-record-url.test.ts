import { describe, it, expect } from "vitest";
import { getCadRecordUrl, isDirectCadRecordUrl, CAD_SEARCH_HOMEPAGE } from "./cad-record-url";

describe("getCadRecordUrl", () => {
  it("returns Bexar's real deep-link pattern", () => {
    expect(getCadRecordUrl({ cad: "Bexar Appraisal District", accountNumber: "12345" })).toBe(
      "https://bexar.trueautomation.com/clientdb/Property.aspx?cid=110&prop_id=12345",
    );
  });

  it("returns Dallas's real deep-link pattern", () => {
    expect(
      getCadRecordUrl({ cad: "Dallas Central Appraisal District", accountNumber: "1149803" }),
    ).toBe("https://www.dallascad.org/AcctDetailCom.aspx?ID=1149803");
  });

  it("returns the real ProdigyCAD deep-link pattern for Denton/Tarrant/Montgomery/Travis", () => {
    expect(
      getCadRecordUrl({ cad: "Denton Central Appraisal District", accountNumber: "34086" }),
    ).toBe("https://www.dentoncad.com/property-detail/34086");
    expect(getCadRecordUrl({ cad: "Tarrant Appraisal District", accountNumber: "41054806" })).toBe(
      "https://tarrant.prodigycad.com/property-detail/41054806",
    );
    expect(
      getCadRecordUrl({ cad: "Montgomery Central Appraisal District", accountNumber: "167662" }),
    ).toBe("https://mcad-tx.org/property-detail/167662");
    expect(
      getCadRecordUrl({ cad: "Travis Central Appraisal District", accountNumber: "230964" }),
    ).toBe("https://travis.prodigycad.com/property-detail/230964");
  });

  it("falls back to the search homepage for every other supported county", () => {
    expect(
      getCadRecordUrl({ cad: "Collin Central Appraisal District", accountNumber: "999" }),
    ).toBe(CAD_SEARCH_HOMEPAGE["Collin Central Appraisal District"]);
    expect(
      getCadRecordUrl({ cad: "Harris Central Appraisal District", accountNumber: "999" }),
    ).toBe(CAD_SEARCH_HOMEPAGE["Harris Central Appraisal District"]);
  });

  it("falls back to the search homepage (or null) when there's no account number, even for a direct-link county", () => {
    expect(getCadRecordUrl({ cad: "Denton Central Appraisal District", accountNumber: null })).toBe(
      CAD_SEARCH_HOMEPAGE["Denton Central Appraisal District"],
    );
    expect(getCadRecordUrl({ cad: "Not A Real CAD", accountNumber: null })).toBeNull();
  });
});

describe("isDirectCadRecordUrl", () => {
  it("is true for every county with a real verified deep link", () => {
    for (const cad of [
      "Bexar Appraisal District",
      "Dallas Central Appraisal District",
      "Denton Central Appraisal District",
      "Tarrant Appraisal District",
      "Montgomery Central Appraisal District",
      "Travis Central Appraisal District",
    ]) {
      expect(isDirectCadRecordUrl(cad)).toBe(true);
    }
  });

  it("is false for counties still on the generic search-homepage fallback", () => {
    expect(isDirectCadRecordUrl("Collin Central Appraisal District")).toBe(false);
    expect(isDirectCadRecordUrl("Harris Central Appraisal District")).toBe(false);
  });
});
