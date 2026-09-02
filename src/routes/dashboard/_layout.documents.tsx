import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { listProperties, type PropertyRecord } from "@/lib/properties";
import { listDocuments, getDocumentUrl, type DocumentRecord } from "@/lib/documents";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/dashboard/_layout/documents")({
  component: Documents,
});

function Documents() {
  const { user } = useAuth();
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    Promise.all([listProperties(user.id), listDocuments(user.id)])
      .then(([props, docs]) => {
        setProperties(props);
        setDocuments(docs);
      })
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, [user]);

  async function handleDownload(doc: DocumentRecord) {
    try {
      const url = await getDocumentUrl(doc.storagePath);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open this document.");
    }
  }

  // Grouped by property — a flat list with the address buried in each
  // row's caption made it genuinely hard to tell at a glance which
  // documents belong to which property, especially for staff reviewing a
  // customer's account with several properties. One card per property
  // (only properties that actually have a document, so this doesn't pad
  // out with empty sections), each with its own compact document rows.
  const groups = properties
    .map((property) => ({
      label: property.address,
      docs: documents.filter((d) => d.propertyId === property.id),
    }))
    .filter((g) => g.docs.length > 0);
  // Documents whose property was since removed still need to be reachable
  // — never silently dropped just because the grouping key no longer
  // resolves to a live property.
  const orphanedDocs = documents.filter((d) => !properties.some((p) => p.id === d.propertyId));
  if (orphanedDocs.length > 0) groups.push({ label: "Property removed", docs: orphanedDocs });

  return (
    <div>
      <h1 className="font-serif text-2xl font-semibold">Documents</h1>
      <p className="text-muted-foreground text-sm">
        Documents you upload during property intake are stored here automatically, grouped by
        property.
      </p>

      <div className="mt-6">
        {loading ? (
          <div className="grid gap-4">
            {[0, 1].map((i) => (
              <div key={i} className="card-elev p-4">
                <Skeleton className="h-5 w-56" />
                <div className="mt-3 grid gap-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : documents.length > 0 ? (
          <div className="grid gap-4">
            {groups.map((group) => (
              <PropertyDocGroup key={group.label} group={group} onDownload={handleDownload} />
            ))}
          </div>
        ) : (
          <div className="card-elev p-8 text-center">
            <h3 className="font-serif text-xl font-semibold">No documents yet.</h3>
            <p className="text-muted-foreground mt-1">
              Documents you upload during property intake are stored here automatically.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function PropertyDocGroup({
  group,
  onDownload,
}: {
  group: { label: string; docs: DocumentRecord[] };
  onDownload: (doc: DocumentRecord) => void;
}) {
  return (
    <div className="card-elev p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold">{group.label}</h2>
        <span className="shrink-0 text-xs text-muted-foreground">
          {group.docs.length} document{group.docs.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="mt-2 grid gap-2">
        {group.docs.map((doc) => (
          <div
            key={doc.id}
            className="row-hover flex items-center justify-between gap-2 rounded-md px-2 py-2 flex-wrap"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{doc.fileName}</div>
              <div className="text-xs text-muted-foreground">
                Uploaded {new Date(doc.uploadedAt).toLocaleDateString()}
                {doc.documentType ? ` • ${doc.documentType}` : ""}
              </div>
            </div>
            <button onClick={() => onDownload(doc)} className="btn-outline shrink-0 text-sm">
              Download
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
