import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { listProperties, type PropertyRecord } from "@/lib/properties";
import { listDocuments, getDocumentUrl, type DocumentRecord } from "@/lib/documents";

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

  const addressFor = (propertyId: string) =>
    properties.find((p) => p.id === propertyId)?.address ?? "Property removed";

  async function handleDownload(doc: DocumentRecord) {
    try {
      const url = await getDocumentUrl(doc.storagePath);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open this document.");
    }
  }

  return (
    <div>
      <h1 className="font-serif text-2xl font-semibold">Documents</h1>
      <p className="text-muted-foreground text-sm">
        Documents you upload during property intake are stored here automatically.
      </p>

      <div className="mt-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : documents.length > 0 ? (
          <div className="grid gap-3">
            {documents.map((doc) => (
              <div key={doc.id} className="card-elev p-4 flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="font-medium">{doc.fileName}</div>
                  <div className="text-xs text-muted-foreground">
                    {addressFor(doc.propertyId)} • Uploaded{" "}
                    {new Date(doc.uploadedAt).toLocaleDateString()}
                    {doc.documentType ? ` • ${doc.documentType}` : ""}
                  </div>
                </div>
                <button onClick={() => handleDownload(doc)} className="btn-outline text-sm">
                  Download
                </button>
              </div>
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
