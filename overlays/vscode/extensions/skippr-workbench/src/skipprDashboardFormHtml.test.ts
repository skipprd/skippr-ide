import assert from "node:assert/strict";
import test from "node:test";
import { dashboardFormSetModeMessage, renderDashboardFormHtml } from "./skipprDashboardFormHtml";

test("dashboard form setMode applies caller dash id", () => {
  const html = renderDashboardFormHtml();
  assert.match(html, /event\.data\.id/);
  assert.match(html, /idInput\.value = event\.data\.id/);
  assert.match(html, /command: "ready"/);
});

test("dashboardFormSetModeMessage keeps caller dash id", () => {
  assert.deepEqual(dashboardFormSetModeMessage("addFromEditor", "revenue_overview"), {
    command: "setMode",
    mode: "addFromEditor",
    id: "revenue_overview"
  });
  assert.deepEqual(dashboardFormSetModeMessage("create"), { command: "setMode", mode: "create" });
});
