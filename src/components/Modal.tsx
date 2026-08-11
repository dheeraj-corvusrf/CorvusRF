import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// Portaled to document.body rather than rendered inline: PdfFormEditor opens
// a second Modal nested inside CaseDetailModal's own Modal (to review/fill a
// document mid-case), and without a portal the inner modal's `position:
// fixed` gets trapped by the outer modal's backdrop-blur-sm — backdrop-filter
// establishes a CSS containing block for fixed descendants, same as
// transform/filter would — shrinking and scroll-merging the inner modal into
// the outer one's box instead of covering the real viewport. Portaling to
// body sidesteps that regardless of how deeply a Modal is nested in the tree.
export function Modal({
  children,
  onClose,
  wide,
}: {
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-primary/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className={`relative overflow-hidden card-elev ${wide ? "w-[75vw] max-w-[75vw]" : "w-full max-w-lg"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 z-10 grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="p-6 pr-12 max-h-[90vh] overflow-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
