import { describe, it, expect } from "vitest";
import {
  isFormComplete,
  getIncompleteRequiredLabels,
  mmddyyyyToIso,
  NOTICE_OF_PROTEST_SCHEMA,
  APPOINTMENT_OF_AGENT_SCHEMA,
  type FieldSection,
  type FieldValues,
} from "./protest-documents";

describe("mmddyyyyToIso", () => {
  it("converts a real MM/DD/YYYY date to ISO for the native date picker", () => {
    expect(mmddyyyyToIso("01/05/2026")).toBe("2026-01-05");
    expect(mmddyyyyToIso("12/31/2026")).toBe("2026-12-31");
  });

  it("pads a single-digit month/day", () => {
    expect(mmddyyyyToIso("1/5/2026")).toBe("2026-01-05");
  });

  it("returns empty for blank, partial, or invalid input rather than guessing", () => {
    expect(mmddyyyyToIso("")).toBe("");
    expect(mmddyyyyToIso("not a date")).toBe("");
    expect(mmddyyyyToIso("13/40/2026")).toBe("");
  });
});

const simpleSchema: FieldSection[] = [
  {
    title: "Section A",
    fields: [
      { type: "text", name: "req_text", label: "Required Text", required: true },
      { type: "text", name: "opt_text", label: "Optional Text" },
      {
        type: "radio",
        name: "req_radio",
        label: "Required Choice",
        options: ["A", "B"],
        required: true,
      },
    ],
  },
  {
    title: "Section B",
    requireAtLeastOne: true,
    fields: [
      { type: "checkbox", name: "box1", label: "Box 1" },
      { type: "checkbox", name: "box2", label: "Box 2" },
    ],
  },
];

describe("isFormComplete / getIncompleteRequiredLabels", () => {
  it("is incomplete when a required text field is blank", () => {
    const values: FieldValues = { req_radio: "A", box1: true };
    expect(isFormComplete(simpleSchema, values)).toBe(false);
    expect(getIncompleteRequiredLabels(simpleSchema, values)).toContain("Required Text");
  });

  it("is incomplete when a required radio field is unanswered", () => {
    const values: FieldValues = { req_text: "hi", box1: true };
    expect(isFormComplete(simpleSchema, values)).toBe(false);
    expect(getIncompleteRequiredLabels(simpleSchema, values)).toContain("Required Choice");
  });

  it("is incomplete when a requireAtLeastOne section has no checkbox checked", () => {
    const values: FieldValues = { req_text: "hi", req_radio: "A" };
    expect(isFormComplete(simpleSchema, values)).toBe(false);
    expect(getIncompleteRequiredLabels(simpleSchema, values)).toContain(
      "Section B — select at least one",
    );
  });

  it("never requires an optional field", () => {
    const values: FieldValues = { req_text: "hi", req_radio: "A", box2: true };
    expect(isFormComplete(simpleSchema, values)).toBe(true);
  });

  it("treats whitespace-only text as incomplete", () => {
    const values: FieldValues = { req_text: "   ", req_radio: "A", box1: true };
    expect(isFormComplete(simpleSchema, values)).toBe(false);
  });

  it("is complete once every required field and group is satisfied", () => {
    const values: FieldValues = { req_text: "hi", opt_text: "", req_radio: "A", box1: true };
    expect(isFormComplete(simpleSchema, values)).toBe(true);
    expect(getIncompleteRequiredLabels(simpleSchema, values)).toEqual([]);
  });
});

describe("real schema completeness", () => {
  it("Notice of Protest is incomplete when blank", () => {
    expect(isFormComplete(NOTICE_OF_PROTEST_SCHEMA, {})).toBe(false);
  });

  it("Notice of Protest becomes complete once every real required field/group is filled", () => {
    const values: FieldValues = {
      "Appraisal Districts Name": "Collin Central Appraisal District",
      "Tax Year": "2026",
      "Name of Property Owner or Lessee": "Test Owner LLC",
      "Physical Address": "123 Main St, Plano, TX",
      "Reason for protest 1": true,
      "Certification and Signature": "Property Owner",
      "Print Name of Property Owner or Authorized Representative": "Jane Owner",
      "Date of Signature": "01/01/2026",
    };
    expect(isFormComplete(NOTICE_OF_PROTEST_SCHEMA, values)).toBe(true);
  });

  it("Appointment of Agent is incomplete when blank", () => {
    expect(isFormComplete(APPOINTMENT_OF_AGENT_SCHEMA, {})).toBe(false);
  });

  it("Appointment of Agent becomes complete once every real required field/group is filled", () => {
    const values: FieldValues = {
      "Appraisal District Name": "Collin Central Appraisal District",
      Name: "Test Owner LLC",
      "all property listed for me at the above address": true,
      Name_2: "Jane Agent",
      "all property tax matters concerning the property identified": true,
      "The agent identified above is authorized to receive confidential information pursuant to Tax Code §§11.48(b)(2), 22.27(b)(2), 23.123(c)(2), 23.126(c)(2), and 23.45(b)(2):":
        "No",
      Date: "01/01/2026",
      "Name of Property Owner": "Jane Owner",
      "the property owner": true,
    };
    expect(isFormComplete(APPOINTMENT_OF_AGENT_SCHEMA, values)).toBe(true);
  });
});
