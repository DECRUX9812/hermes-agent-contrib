import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Renders a dashboard modal into `document.body` so its `z-[100]` backdrop
 * escapes the dashboard column's `relative z-2` stacking context and paints
 * above the sidebar / mobile header (see `lib/dashboard-modal-shell.ts`).
 */
export function DashboardModalPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
