import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PropertyRecord } from "./properties";
import type { EvidenceItemRecord } from "./protest-case";

vi.mock("./documents", () => ({
  getDocumentUrl: vi.fn(async (path: string) => `https://signed.example/${path}`),
}));
vi.mock("./edge-functions", () => ({
  invokeEdgeFunction: vi.fn(async () => ({ text: "Suggested reason text." })),
}));

import { getDocumentUrl } from "./documents";
import { invokeEdgeFunction } from "./edge-functions";
import { draftProtestReason, NoEvidenceDocumentsError } from "./protest-reason";

const property: PropertyRecord = {
  id: "prop-1",
  address: "123 Main St, Plano, TX 75023",
  cad: "Collin Central Appraisal District",
  accountNumber: "12345",
  ownerName: "Test Owner LLC",
  propertyType: "Commercial",
  landValue: 100000,
  improvementValue: 400000,
  totalValue: 500000,
  taxYear: 2026,
  protestDeadline: "2099-05-15",
  paymentDueDate: null,
  taxAmountDue: null,
  paidAt: null,
  estimatedSavings: null,
  savingsBasis: null,
  createdAt: "2026-01-01T00:00:00Z",
  valueHistory: null,
};

function evidenceWith(
  documents: { id: string; fileName: string; storagePath: string }[],
): EvidenceItemRecord[] {
  return [
    {
      id: "e1",
      protestId: "protest-1",
      label: "Independent Fee Appraisal Report",
      documents,
      createdAt: "2026-01-01",
    },
  ];
}

function mockFetchOk(bytes = new Uint8Array([1, 2, 3]), type = "application/pdf") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      blob: async () => ({
        size: bytes.length,
        type,
        arrayBuffer: async () => bytes.buffer,
      }),
    })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("draftProtestReason", () => {
  it("throws NoEvidenceDocumentsError when there are no evidence items at all", async () => {
    await expect(draftProtestReason(property, null, [])).rejects.toThrow(NoEvidenceDocumentsError);
  });

  it("throws NoEvidenceDocumentsError when every document fails to download", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );
    const items = evidenceWith([
      { id: "d1", fileName: "rent-roll.pdf", storagePath: "u/p/rr.pdf" },
    ]);
    await expect(draftProtestReason(property, null, items)).rejects.toThrow(
      NoEvidenceDocumentsError,
    );
  });

  it("downloads real document bytes via getDocumentUrl and calls the edge function", async () => {
    mockFetchOk();
    const items = evidenceWith([
      { id: "d1", fileName: "rent-roll.pdf", storagePath: "u/p/rr.pdf" },
    ]);
    const result = await draftProtestReason(property, "Market Value", items);

    expect(result).toBe("Suggested reason text.");
    expect(getDocumentUrl).toHaveBeenCalledWith("u/p/rr.pdf");
    expect(invokeEdgeFunction).toHaveBeenCalledWith(
      "draft-protest-reason",
      expect.objectContaining({
        property: expect.objectContaining({
          address: property.address,
          cad: property.cad,
          strategyRecommendation: "Market Value",
        }),
        documents: [
          expect.objectContaining({ fileName: "rent-roll.pdf", mimeType: "application/pdf" }),
        ],
      }),
    );
  });

  it("skips a document over the size cap rather than sending or guessing at it", async () => {
    const big = new Uint8Array(9 * 1024 * 1024); // over the 8MB cap
    mockFetchOk(big);
    const items = evidenceWith([{ id: "d1", fileName: "huge.pdf", storagePath: "u/p/huge.pdf" }]);
    await expect(draftProtestReason(property, null, items)).rejects.toThrow(
      NoEvidenceDocumentsError,
    );
  });

  it("sends up to 5 documents across multiple evidence items, not just the first item's", async () => {
    mockFetchOk();
    const items: EvidenceItemRecord[] = [
      {
        id: "e1",
        protestId: "protest-1",
        label: "Rent Roll",
        documents: [{ id: "d1", fileName: "a.pdf", storagePath: "u/p/a.pdf" }],
        createdAt: "2026-01-01",
      },
      {
        id: "e2",
        protestId: "protest-1",
        label: "Photos",
        documents: [
          { id: "d2", fileName: "b.jpg", storagePath: "u/p/b.jpg" },
          { id: "d3", fileName: "c.jpg", storagePath: "u/p/c.jpg" },
        ],
        createdAt: "2026-01-01",
      },
    ];
    await draftProtestReason(property, null, items);
    const call = vi.mocked(invokeEdgeFunction).mock.calls[0][1] as { documents: unknown[] };
    expect(call.documents).toHaveLength(3);
  });
});
