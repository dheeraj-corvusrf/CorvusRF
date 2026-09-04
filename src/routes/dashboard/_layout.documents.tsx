import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { listProperties, type PropertyRecord } from "@/lib/properties";
import { listDocuments, getDocumentUrl, type DocumentRecord } from "@/lib/documents";
import {
  classifyAndUpload,
  assignAndUpload,
  type CategorizedUpload,
} from "@/lib/document-categorize";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown } from "lucide-react";

export const Route = createFileRoute("/dashboard/_layout/documents")({
  component: Documents,
});

function Documents() {
  const { user } = useAuth();
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploads, setUploads] = useState<CategorizedUpload[]>([]);

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

  // One classify-then-upload call per file, sequentially — not Promise.all,
  // same reasoning as every other bulk action this session (Bulk Invite,
  // bulk delete): a slow or failing file shouldn't race every other file's
  // AI call at once, and each row's status updates as its own turn finishes
  // instead of the whole batch going from "processing" to "done" together.
  async function handleFilesSelected(files: File[]) {
    if (!user || files.length === 0) return;
    const pending: CategorizedUpload[] = files.map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}`,
      file,
      status: "classifying",
      extraction: null,
      matchedProperty: null,
      document: null,
      error: null,
    }));
    setUploads((prev) => [...pending, ...prev]);

    for (const file of files) {
      const result = await classifyAndUpload(user.id, properties, file);
      setUploads((prev) => prev.map((u) => (u.id === result.id ? result : u)));
      if (result.status === "done" && result.document) {
        setDocuments((prev) => [result.document!, ...prev]);
      }
    }
  }

  async function handleAssignProperty(upload: CategorizedUpload, propertyId: string) {
    if (!user) return;
    const property = properties.find((p) => p.id === propertyId);
    if (!property) return;
    setUploads((prev) => prev.map((u) => (u.id === upload.id ? { ...u, status: "uploading" } : u)));
    const result = await assignAndUpload(user.id, property, upload);
    setUploads((prev) => prev.map((u) => (u.id === result.id ? result : u)));
    if (result.status === "done" && result.document) {
      setDocuments((prev) => [result.document!, ...prev]);
    }
  }

  function dismissUpload(id: string) {
    setUploads((prev) => prev.filter((u) => u.id !== id));
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
        Documents you upload during property intake land here automatically — or upload several at
        once below and AI will read each one and sort it to the right property for you.
      </p>

      <div className="mt-6 card-elev p-6">
        <h2 className="font-semibold">Upload Documents</h2>
        <p className="text-sm text-muted-foreground">
          Select any number of appraisal notices, tax bills, or other property tax documents — no
          need to sort them first. AI reads each one and matches it to the right property by its
          account number or address.
        </p>
        <label
          className={`btn-primary btn-primary-hover mt-3 inline-flex w-fit cursor-pointer text-sm ${
            !user ? "pointer-events-none opacity-60" : ""
          }`}
        >
          Choose Files
          <input
            type="file"
            accept="application/pdf,image/*"
            multiple
            disabled={!user}
            className="hidden"
            onChange={(e) => {
              const selected = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = "";
              if (selected.length > 0) handleFilesSelected(selected);
            }}
          />
        </label>

        {uploads.length > 0 && (
          <div className="mt-4 grid gap-2">
            {uploads.map((upload) => (
              <UploadRow
                key={upload.id}
                upload={upload}
                properties={properties}
                onAssign={(propertyId) => handleAssignProperty(upload, propertyId)}
                onDismiss={() => dismissUpload(upload.id)}
              />
            ))}
          </div>
        )}
      </div>

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
              <PropertyDocGroup
                key={group.label}
                group={group}
                onDownload={handleDownload}
                defaultExpanded={groups.length === 1}
              />
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

function UploadRow({
  upload,
  properties,
  onAssign,
  onDismiss,
}: {
  upload: CategorizedUpload;
  properties: PropertyRecord[];
  onAssign: (propertyId: string) => void;
  onDismiss: () => void;
}) {
  return (
    <div className="rounded-md bg-secondary/40 px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{upload.file.name}</div>
          {upload.status === "done" && upload.matchedProperty && (
            <div className="text-xs text-success">
              Matched to {upload.matchedProperty.address}
              {upload.extraction?.documentType ? ` — ${upload.extraction.documentType}` : ""}
            </div>
          )}
          {upload.status === "error" && (
            <div className="text-xs text-destructive">{upload.error}</div>
          )}
          {upload.status === "needs-property" && (
            <div className="text-xs text-muted-foreground">
              AI couldn't tell which property this belongs to — pick one below.
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {(upload.status === "classifying" || upload.status === "uploading") && (
            <span className="text-xs text-muted-foreground">
              {upload.status === "classifying" ? "Reading…" : "Uploading…"}
            </span>
          )}
          {upload.status === "done" && <span className="text-xs text-success">✓ Uploaded</span>}
          {(upload.status === "done" || upload.status === "error") && (
            <button
              type="button"
              onClick={onDismiss}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>
      {upload.status === "needs-property" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) onAssign(e.target.value);
            }}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
          >
            <option value="" disabled>
              Choose a property…
            </option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.address}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onDismiss}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Skip
          </button>
        </div>
      )}
    </div>
  );
}

function PropertyDocGroup({
  group,
  onDownload,
  defaultExpanded,
}: {
  group: { label: string; docs: DocumentRecord[] };
  onDownload: (doc: DocumentRecord) => void;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <div className="card-elev p-4">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 min-w-0">
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
          />
          <h2 className="truncate font-semibold">{group.label}</h2>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {group.docs.length} document{group.docs.length === 1 ? "" : "s"}
        </span>
      </button>
      {expanded && (
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
      )}
    </div>
  );
}
