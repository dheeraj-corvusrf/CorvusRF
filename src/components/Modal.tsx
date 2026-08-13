import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

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
  // Without this, the page behind the modal keeps scrolling along with it —
  // there's nothing else stopping wheel/touch input from reaching the body
  // underneath the fixed overlay. Restores whatever overflow value was already
  // on body (rather than assuming "") so nesting one Modal inside another (see
  // the portal comment below) doesn't have the inner modal's cleanup
  // incorrectly re-enable scroll while the outer one is still open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-primary/60 backdrop-blur-sm backdrop-fade-in"
      onClick={onClose}
    >
      <div
        className={`relative overflow-hidden card-elev ${wide ? "w-[75vw] max-w-[75vw]" : "w-full max-w-lg"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute top-3 right-3 z-10 grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-all hover:scale-110 hover:bg-secondary hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Close</TooltipContent>
        </Tooltip>
        <div className="p-6 pr-12 max-h-[90vh] overflow-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
