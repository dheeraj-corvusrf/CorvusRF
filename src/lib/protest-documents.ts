import { PDFDocument } from "pdf-lib";
import type { PropertyRecord } from "./properties";
import type { AuthorizationRecord } from "./protest-authorizations";
import { AGREEMENT } from "@/components/ProtestAuthorizationFlow";

// Drives every field on the two REAL, official Texas Comptroller PDF forms
// (committed verbatim in public/forms/ — not recreated). Field names/labels/
// radio options below were read directly off each PDF's AcroForm via pdf-lib
// (getForm().getFields()) cross-referenced with pdftotext's layout extraction
// — none are guessed. Neither form's signature line is exposed here (Form
// 50-132's is a true /Sig field pdf-lib can't plain-fill anyway; Form 50-162's
// needs a real signature at filing time, not a copy of an e-signature given
// for a different document).

export type FieldDef =
  | { type: "text"; name: string; label: string }
  | { type: "checkbox"; name: string; label: string }
  | { type: "radio"; name: string; label: string; options: string[] };

export type FieldSection = { title: string; fields: FieldDef[] };

export type FieldValues = Record<string, string | boolean>;

export const NOTICE_OF_PROTEST_SCHEMA: FieldSection[] = [
  {
    title: "Appraisal District & Tax Year",
    fields: [
      { type: "text", name: "Appraisal Districts Name", label: "Appraisal District's County" },
      { type: "text", name: "Appraisal District Account Number", label: "Appraisal District Account Number (if known)" },
      { type: "text", name: "Tax Year", label: "Tax Year" },
    ],
  },
  {
    title: "Section 1: Property Owner or Lessee",
    fields: [
      {
        type: "radio",
        name: "Property owner type",
        label: "Property owner type (if applicable)",
        options: [
          "Person Age 65 or Older",
          "Disabled Person",
          "Military Service Member",
          "Military Veteran",
          "Spouse of a Military Service Member or Veteran",
        ],
      },
      { type: "text", name: "Name of Property Owner or Lessee", label: "Name of Property Owner or Lessee" },
      { type: "text", name: "Mailing Address City State ZIP Code", label: "Mailing Address, City, State, ZIP Code" },
      { type: "text", name: "Phone Number area code and number", label: "Phone Number (area code and number)" },
    ],
  },
  {
    title: "Section 2: Property Description",
    fields: [
      { type: "text", name: "Physical Address", label: "Physical Address, City, State, ZIP Code" },
      { type: "text", name: "Legal description", label: "Legal description (if no street address)" },
      { type: "text", name: "Mobile Home", label: "Mobile Home Make, Model and Identification (if applicable)" },
    ],
  },
  {
    title: "Section 3: Reasons for Protest",
    fields: [
      {
        type: "checkbox",
        name: "Reason for protest 1",
        label: "Incorrect appraised (market) value and/or value is unequal compared with other properties.",
      },
      { type: "text", name: "Taxing Unit", label: "Taxing unit (for “should not be taxed in …”, if that reason applies)" },
      { type: "checkbox", name: "Reason for protest 2", label: "Property should not be taxed in the taxing unit named above." },
      {
        type: "checkbox",
        name: "Reason for protest 3",
        label:
          "Property is not located in this appraisal district or otherwise should not be included on the appraisal district's record.",
      },
      { type: "text", name: "Type of notice", label: "Type of notice not received (for “failure to send required notice”, if that reason applies)" },
      { type: "checkbox", name: "Reason for protest 4", label: "Failure to send required notice." },
      { type: "checkbox", name: "Reason for protest 5", label: "Exemption was denied, modified or canceled." },
      { type: "checkbox", name: "Reason for protest 6", label: "Temporary disaster damage exemption was denied or modified." },
      {
        type: "checkbox",
        name: "Reason for protest 7",
        label: "Ag-use, open-space or other special appraisal was denied, modified or canceled.",
      },
      { type: "checkbox", name: "Reason for protest 8", label: "Change in use of land appraised as ag-use, open-space or timberland." },
      {
        type: "checkbox",
        name: "Reason for protest 9",
        label:
          "Incorrect appraised or market value of land under special appraisal for ag-use, open-space or other special appraisal.",
      },
      { type: "checkbox", name: "Reason for protest 10", label: "Owner's name is incorrect." },
      { type: "checkbox", name: "Reason for protest 11", label: "Property description is incorrect." },
      {
        type: "checkbox",
        name: "Reason for protest 12",
        label: "Incorrect damage assessment rating for a property qualified for a temporary disaster exemption.",
      },
      {
        type: "checkbox",
        name: "Reason for protest 13",
        label: "Circuit breaker limitation on appraised value for all other real property was denied, modified or canceled.",
      },
      {
        type: "checkbox",
        name: "Reason for protest 14",
        label:
          "Incorrect appraised value and allocation of value of a structure, archaeological site and land necessary for access under a historic site exemption.",
      },
      { type: "text", name: "Other disaster exemption", label: "Other (describe, if applicable to a reason above)" },
      { type: "text", name: "Other description", label: "Other reason (for the “Other” box, if that reason applies)" },
      { type: "checkbox", name: "Reason for protest 15", label: "Other." },
    ],
  },
  {
    title: "Section 4: Additional Facts",
    fields: [
      { type: "text", name: "Opinion of property value", label: "What is your opinion of your property's value? (optional) $" },
      { type: "text", name: "Facts to resolve protest", label: "Facts that may help resolve this protest" },
    ],
  },
  {
    title: "Section 5: Hearing Type",
    fields: [
      { type: "radio", name: "Do you request an informal conference", label: "Request an informal conference before the hearing?", options: ["Yes", "No"] },
      {
        type: "radio",
        name: "ARB panel",
        label: "Single-member ARB panel or a regular panel of at least three members?",
        options: ["a single-member ARB panel", "a regular ARB panel of at least three members"],
      },
      {
        type: "radio",
        name: "ARB hearing",
        label: "How do you intend to appear at the ARB hearing?",
        options: [
          "In person",
          " By telephone conference call and will submit evidence with a written affidavit delivered to the ARB before the hearing begins.** (may use Comptroller Form 50-283, Property Owner Affidavit of Evidence)",
          " By videoconference and will submit evidence with a written affidavit delivered to the ARB before the hearing begins.** (may use Comptroller Form 50-283, Property Owner Affidavit of Evidence)",
          " On written affidavit submitted with evidence and delivered to the ARB before the hearing begins",
        ],
      },
    ],
  },
  {
    title: "Section 6: ARB Hearing Notice and Procedures",
    fields: [
      {
        type: "radio",
        name: "Notice of hearing",
        label: "Deliver my notice of hearing by",
        options: ["Regular first-class mail", "Certified mail and agree to pay the cost (if applicable)"],
      },
      { type: "radio", name: "Hearing Procedures", label: "Send me a copy of the ARB's hearing procedures?", options: ["Yes", "No"] },
      {
        type: "radio",
        name: "Electronic reminder",
        label: "Electronic reminder of the hearing date/time?",
        options: ["Yes, by text", "Yes, by email", "No"],
      },
      { type: "text", name: "Mobile Number", label: "Mobile phone number (if reminder by text)" },
      { type: "text", name: "Email Address", label: "Email address (if reminder by email)" },
    ],
  },
  {
    title: "Section 7: Special Panel Request ($62.9 Million or More)",
    fields: [
      { type: "radio", name: "Request for special panel", label: "Request a special panel to hear my protest?", options: ["Yes", "No"] },
      { type: "radio", name: "Property is appraised at $57 million or greater", label: "Property is appraised at $57 million or greater", options: ["No"] },
      { type: "radio", name: "Property is appraised at $62.9 million or greater", label: "Property is appraised at $62.9 million or greater", options: ["Yes"] },
      { type: "text", name: "Appraisal districts value assigned to property", label: "Appraisal district's value assigned to your property $" },
      {
        type: "radio",
        name: "Classification of your property",
        label: "Property classification",
        options: [
          "Commercial real and personal property ",
          "Industrial and manufacturing real and personal property",
          "Real and personal property of utilities",
          "Multifamily residential real property",
        ],
      },
    ],
  },
  {
    title: "Section 8: Certification",
    fields: [
      {
        type: "radio",
        name: "Certification and Signature",
        label: "Signing as",
        options: ["Property Owner", "Property Owner's agent", "Other (please specify)"],
      },
      { type: "text", name: "Print Name of Property Owner or Authorized Representative", label: "Print Name of Property Owner or Authorized Representative" },
      { type: "text", name: "Date of Signature", label: "Date" },
    ],
  },
];

export const APPOINTMENT_OF_AGENT_SCHEMA: FieldSection[] = [
  {
    title: "Appraisal District",
    fields: [
      { type: "text", name: "Appraisal District Name", label: "Appraisal District Name" },
      { type: "text", name: "Date Received appraisal district use only", label: "Date Received (appraisal district use only)" },
    ],
  },
  {
    title: "STEP 1: Owner's Name and Address",
    fields: [
      { type: "text", name: "Name", label: "Name" },
      { type: "text", name: "Telephone Number include area code", label: "Telephone Number (include area code)" },
      { type: "text", name: "Address", label: "Address" },
      { type: "text", name: "City State Zip Code", label: "City, State, Zip Code" },
    ],
  },
  {
    title: "STEP 2: Identify the Property",
    fields: [
      { type: "checkbox", name: "all property listed for me at the above address", label: "All property listed for me at the above address" },
      { type: "checkbox", name: "the property(ies) listed below:", label: "The property(ies) listed below" },
      { type: "text", name: "Appraisal District Account Number_2", label: "Property 1 — Appraisal District Account Number" },
      { type: "text", name: "Physical or Situs Address of Property_2", label: "Property 1 — Physical or Situs Address" },
      { type: "text", name: "Legal Description_2", label: "Property 1 — Legal Description" },
      { type: "text", name: "Appraisal District Account Number_3", label: "Property 2 — Appraisal District Account Number" },
      { type: "text", name: "Physical or Situs Address of Property_3", label: "Property 2 — Physical or Situs Address" },
      { type: "text", name: "Legal Description_3", label: "Property 2 — Legal Description" },
      { type: "text", name: "Appraisal District Account Number_4", label: "Property 3 — Appraisal District Account Number" },
      { type: "text", name: "Physical or Situs Address of Property_4", label: "Property 3 — Physical or Situs Address" },
      { type: "text", name: "Legal Description_4", label: "Property 3 — Legal Description" },
      { type: "text", name: "Appraisal District Account Number_5", label: "Property 4 — Appraisal District Account Number" },
      { type: "text", name: "Physical or Situs Address of Property_5", label: "Property 4 — Physical or Situs Address" },
      { type: "text", name: "Legal Description_5", label: "Property 4 — Legal Description" },
      { type: "text", name: "Number of additional sheets attatched", label: "Number of additional sheets attached" },
    ],
  },
  {
    title: "STEP 3: Identify the Agent",
    fields: [
      { type: "text", name: "Name_2", label: "Name" },
      { type: "text", name: "Telephone Number include area code_2", label: "Telephone Number (include area code)" },
      { type: "text", name: "Address_2", label: "Address" },
      { type: "text", name: "City State Zip Code_2", label: "City, State, Zip Code" },
    ],
  },
  {
    title: "STEP 4: Specify the Agent's Authority",
    fields: [
      { type: "checkbox", name: "all property tax matters concerning the property identified", label: "All property tax matters concerning the property identified" },
      { type: "checkbox", name: "the following specific property tax matters:", label: "The following specific property tax matters" },
      { type: "text", name: "specific property tax matters", label: "Specific property tax matters (if the box above is checked)" },
      {
        type: "radio",
        name: "The agent identified above is authorized to receive confidential information pursuant to Tax Code §§11.48(b)(2), 22.27(b)(2), 23.123(c)(2), 23.126(c)(2), and 23.45(b)(2):",
        label: "Agent authorized to receive confidential information?",
        options: ["Yes", "No"],
      },
      { type: "checkbox", name: "all communications from the chief appraiser", label: "Deliver all communications from the chief appraiser to the agent" },
      { type: "checkbox", name: "all communications from the appraisal review board", label: "Deliver all communications from the appraisal review board to the agent" },
      {
        type: "checkbox",
        name: "all communications from all taxing units participating in the appraisal district",
        label: "Deliver all communications from all taxing units participating in the appraisal district to the agent",
      },
    ],
  },
  {
    title: "STEP 5: Date the Agent's Authority Ends",
    fields: [{ type: "text", name: "Date Agents Authority Ends", label: "Date Agent's Authority Ends" }],
  },
  {
    title: "STEP 6: Identification, Signature, and Date",
    fields: [
      { type: "text", name: "Date", label: "Date" },
      { type: "text", name: "Name of Property Owner", label: "Printed Name of Property Owner, Property Manager or Other Authorized Person" },
      { type: "text", name: "Title", label: "Title" },
      { type: "checkbox", name: "the property owner", label: "The individual signing this form is the property owner" },
      {
        type: "checkbox",
        name: "a property manager authorized to designate agents for the owner",
        label: "The individual signing this form is a property manager authorized to designate agents for the owner",
      },
      {
        type: "checkbox",
        name: "other person authorized to act on behalf of the owner other than the person being designated as agent",
        label: "The individual signing this form is another person authorized to act on behalf of the owner (other than the agent)",
      },
    ],
  },
];

// The one grounds-for-protest checkbox our data can actually back — every
// strategy our AI case prep can recommend (Market Value, Unequal Appraisal,
// Condition-Based Reduction, Combined Approach) reduces to Form 50-132's
// "Reason for protest 1" ("Incorrect appraised (market) value and/or value is
// unequal compared with other properties") — the form has no separate box per
// strategy. Left unchecked with no guess if no strategy has been generated yet.
export function getNoticeOfProtestDefaults(
  property: PropertyRecord,
  taxYear: number | null,
  strategyRecommendation: string | null,
  authorization?: AuthorizationRecord | null,
): FieldValues {
  return {
    "Appraisal Districts Name": property.cad ?? "",
    "Appraisal District Account Number": property.accountNumber ?? "",
    "Tax Year": taxYear != null ? String(taxYear) : "",
    "Name of Property Owner or Lessee": property.ownerName ?? "",
    "Physical Address": property.address ?? "",
    "Phone Number area code and number": authorization?.phone ?? "",
    "Reason for protest 1": !!strategyRecommendation,
  };
}

function splitAgentAddress(): { street: string; cityStateZip: string } {
  const [street, ...rest] = AGREEMENT.address.split(",");
  return { street: street.trim(), cityStateZip: rest.join(",").trim() };
}

export function getAppointmentOfAgentDefaults(
  authorization: AuthorizationRecord,
  property: PropertyRecord,
): FieldValues {
  const ownerName =
    authorization.isEntity && authorization.entityName
      ? authorization.entityName
      : `${authorization.firstName} ${authorization.lastName}`;
  const { street, cityStateZip } = splitAgentAddress();
  const confidentialFieldName =
    "The agent identified above is authorized to receive confidential information pursuant to Tax Code §§11.48(b)(2), 22.27(b)(2), 23.123(c)(2), 23.126(c)(2), and 23.45(b)(2):";

  return {
    "Appraisal District Name": property.cad ?? "",
    Name: ownerName,
    "Telephone Number include area code": authorization.phone ?? "",
    "the property(ies) listed below:": true,
    "Appraisal District Account Number_2": property.accountNumber ?? "",
    "Physical or Situs Address of Property_2": property.address ?? "",
    Name_2: "CorvusPT.ai",
    "Telephone Number include area code_2": AGREEMENT.phone,
    Address_2: street,
    "City State Zip Code_2": cityStateZip,
    "all property tax matters concerning the property identified": true,
    [confidentialFieldName]: "Yes",
    "all communications from the chief appraiser": true,
    "all communications from the appraisal review board": true,
    "all communications from all taxing units participating in the appraisal district": true,
    "Name of Property Owner": ownerName,
    Title: authorization.isEntity ? (authorization.entityRelationship ?? "") : "",
    "the property owner": !authorization.isEntity,
  };
}

async function loadTemplate(path: string): Promise<PDFDocument> {
  const res = await fetch(`${import.meta.env.BASE_URL}${path}`);
  const bytes = await res.arrayBuffer();
  return PDFDocument.load(bytes);
}

function setText(doc: PDFDocument, field: string, value: string | null | undefined) {
  if (!value) return;
  try {
    doc.getForm().getTextField(field).setText(value);
  } catch {
    // Field renamed/removed upstream by the Comptroller — fail soft rather than
    // block the whole document over one cosmetic field.
  }
}

function check(doc: PDFDocument, field: string) {
  try {
    doc.getForm().getCheckBox(field).check();
  } catch {
    // see setText()
  }
}

function selectRadio(doc: PDFDocument, field: string, option: string) {
  try {
    doc.getForm().getRadioGroup(field).select(option);
  } catch {
    // see setText()
  }
}

// Generic — every field on either form is one of text/checkbox/radio, so one
// fill loop over the schema (rather than a bespoke function per form) covers
// both, driven entirely by the (possibly user-edited) values passed in.
export async function buildPdf(
  templatePath: string,
  schema: FieldSection[],
  values: FieldValues,
): Promise<Uint8Array> {
  const doc = await loadTemplate(templatePath);
  for (const section of schema) {
    for (const field of section.fields) {
      const value = values[field.name];
      if (field.type === "text") {
        setText(doc, field.name, typeof value === "string" ? value : undefined);
      } else if (field.type === "checkbox") {
        if (value) check(doc, field.name);
      } else if (field.type === "radio") {
        if (typeof value === "string" && value) selectRadio(doc, field.name, value);
      }
    }
  }
  return doc.save();
}

export function downloadPdf(bytes: Uint8Array, filename: string) {
  // pdf-lib's .save() types its result as Uint8Array<ArrayBufferLike>, which TS's
  // DOM lib doesn't accept as a BlobPart (it wants a concrete ArrayBuffer) — the
  // bytes themselves are a plain Uint8Array at runtime, so this cast is safe.
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
