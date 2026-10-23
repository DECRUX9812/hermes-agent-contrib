// @vitest-environment jsdom
// Dashboard modals must render under document.body: the page column is
// `relative z-2`, so a `fixed z-[100]` backdrop rendered inside it is painted
// beneath the sidebar (z-50) and mobile header (z-40).

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { DashboardModalPortal } from "./DashboardModalPortal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("DashboardModalPortal", () => {
  it("renders the modal outside the page column's stacking context", () => {
    host = document.createElement("div");
    host.className = "relative z-2";
    document.body.appendChild(host);
    root = createRoot(host);

    act(() => {
      root!.render(
        <DashboardModalPortal>
          <div data-testid="modal" role="dialog" />
        </DashboardModalPortal>,
      );
    });

    const modal = document.querySelector('[data-testid="modal"]');
    expect(modal).not.toBeNull();
    expect(modal!.parentElement).toBe(document.body);
    expect(host.contains(modal)).toBe(false);
  });
});
