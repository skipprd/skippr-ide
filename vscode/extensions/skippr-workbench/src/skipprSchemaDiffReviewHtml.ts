import type { SchemaDiffReviewState } from "./skipprSchemaDiffReview";

export interface SchemaDiffReviewPanelPayload {
  type: "schemaDiffReview";
  status: "idle" | "ready" | "saving" | "error";
  pipeline?: string;
  configPath?: string;
  state?: SchemaDiffReviewState;
  activeNamespace?: string;
  error?: string;
  message?: string;
}

export function renderSkipprSchemaDiffReviewHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <style>
    body { margin: 0; padding: 10px 12px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font: 12px var(--vscode-font-family); }
    h2 { margin: 0 0 6px; font-size: 13px; font-weight: 600; }
    .meta { color: var(--vscode-descriptionForeground); margin-bottom: 10px; line-height: 1.4; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; align-items: center; }
    button { font: inherit; cursor: pointer; border-radius: 4px; border: 1px solid var(--vscode-button-border, var(--vscode-panel-border)); background: var(--vscode-button-secondaryBackground, transparent); color: var(--vscode-button-secondaryForeground, inherit); padding: 4px 8px; }
    button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-button-background); }
    button:disabled { opacity: .45; cursor: default; }
    button:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground)); }
    button.primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
    .tabs { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 10px; }
    .tab { padding: 4px 8px; border-radius: 4px; border: 1px solid transparent; cursor: pointer; color: var(--vscode-descriptionForeground); }
    .tab.active { border-color: var(--vscode-focusBorder); color: var(--vscode-foreground); background: var(--vscode-list-inactiveSelectionBackground); }
    .tab.dirty::after { content: " *"; color: var(--vscode-textLink-foreground); }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; }
    th { color: var(--vscode-descriptionForeground); font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
    .kind { font-weight: 600; text-transform: capitalize; }
    .kind.added { color: var(--vscode-gitDecoration-addedResourceForeground, #3fb950); }
    .kind.removed { color: var(--vscode-gitDecoration-deletedResourceForeground, #f85149); }
    .kind.changed { color: var(--vscode-gitDecoration-modifiedResourceForeground, #d29922); }
    .actions { display: flex; gap: 4px; flex-wrap: wrap; }
    .actions button { padding: 2px 6px; font-size: 10px; }
    .actions button.active { outline: 1px solid var(--vscode-focusBorder); }
    input, select { font: inherit; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 3px; padding: 2px 4px; max-width: 100%; }
    .empty, .error { color: var(--vscode-descriptionForeground); line-height: 1.45; padding: 8px 0; }
    .error { color: var(--vscode-errorForeground); }
    .help { margin-top: 12px; color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.4; }
  </style>
</head>
<body>
  <h2>Schema diff review</h2>
  <div id="meta" class="meta"></div>
  <div id="toolbar" class="toolbar"></div>
  <div id="tabs" class="tabs"></div>
  <div id="content"></div>
  <div class="help">Approve or reject each proposed change. Rejecting an addition omits that field from saved metadata. Top-level fields only.</div>
  <script>
    (function () {
      const vscode = acquireVsCodeApi();
      const metaEl = document.getElementById("meta");
      const toolbarEl = document.getElementById("toolbar");
      const tabsEl = document.getElementById("tabs");
      const contentEl = document.getElementById("content");
      let payload = { type: "schemaDiffReview", status: "idle" };
      let activeNamespace = "";

      function esc(v) {
        return String(v == null ? "" : v).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
      }

      function fieldTypes() {
        return ["string", "long", "integer", "double", "float", "boolean", "date", "timestamp", "binary", "json"];
      }

      function renderMeta() {
        const pipeline = payload.pipeline || "—";
        const config = payload.configPath || "—";
        const dirty = payload.state && payload.state.dirty;
        metaEl.innerHTML = "Pipeline <strong>" + esc(pipeline) + "</strong> · Config " + esc(config) +
          (dirty ? ' · <span style="color:var(--vscode-textLink-foreground)">Unsaved edits</span>' : "");
      }

      function renderToolbar() {
        const saving = payload.status === "saving";
        const dirty = payload.state && payload.state.dirty;
        const ready = payload.status === "ready" && payload.state;
        toolbarEl.innerHTML =
          '<button type="button" data-action="approveAll"' + (ready ? "" : " disabled") + '>Approve all</button>' +
          '<button type="button" data-action="rejectAll"' + (ready ? "" : " disabled") + '>Reject all</button>' +
          '<button type="button" data-action="reset"' + (ready ? "" : " disabled") + '>Reset</button>' +
          '<button type="button" class="primary" data-action="save"' + (ready && dirty && !saving ? "" : " disabled") + '>' +
          (saving ? "Saving…" : "Save") + '</button>';
      }

      function namespaceDirty(ns) {
        return (ns.rows || []).some(row => row.decision !== "approved" || (row.kind === "changed" && row.editedAfter));
      }

      function renderTabs() {
        const namespaces = (payload.state && payload.state.namespaces) || [];
        if (!namespaces.length) {
          tabsEl.innerHTML = "";
          return;
        }
        if (!activeNamespace || !namespaces.some(ns => ns.namespace === activeNamespace)) {
          activeNamespace = namespaces[0].namespace;
        }
        tabsEl.innerHTML = namespaces.map(ns => {
          const cls = "tab" + (ns.namespace === activeNamespace ? " active" : "") + (namespaceDirty(ns) ? " dirty" : "");
          return '<span class="' + cls + '" data-namespace="' + esc(ns.namespace) + '">' + esc(ns.namespace) + '</span>';
        }).join("");
      }

      function typeSelect(row, value, disabled) {
        const options = fieldTypes().map(t => '<option value="' + esc(t) + '"' + (t === value ? " selected" : "") + '>' + esc(t) + '</option>').join("");
        return '<select data-edit="type" data-row="' + esc(row.id) + '"' + (disabled ? " disabled" : "") + '>' + options + '</select>';
      }

      function renderRow(row) {
        const approveCls = row.decision === "approved" ? " active" : "";
        const rejectCls = row.decision === "rejected" ? " active" : "";
        let detail = "";
        if (row.kind === "added") {
          const after = row.after || {};
          detail = esc(after.field_type || "unknown") + (after.nullable === false ? " · required" : " · nullable");
        } else if (row.kind === "removed") {
          const before = row.before || {};
          detail = esc(before.field_type || "unknown") + (before.nullable === false ? " · required" : " · nullable");
        } else {
          const after = row.editedAfter || row.after || {};
          const before = row.before || {};
          detail = esc(before.field_type || "?") + " → " + typeSelect(row, after.field_type || "string", row.decision === "rejected") +
            ' <label><input type="checkbox" data-edit="nullable" data-row="' + esc(row.id) + '"' +
            ((after.nullable !== false) ? " checked" : "") + (row.decision === "rejected" ? " disabled" : "") + '> nullable</label>';
        }
        return '<tr data-row="' + esc(row.id) + '">' +
          '<td class="kind ' + esc(row.kind) + '">' + esc(row.kind) + '</td>' +
          '<td><strong>' + esc(row.fieldName) + '</strong></td>' +
          '<td>' + detail + '</td>' +
          '<td><div class="actions">' +
          '<button type="button" data-decision="approved" class="' + approveCls + '">Approve</button>' +
          '<button type="button" data-decision="rejected" class="' + rejectCls + '">Reject</button>' +
          '</div></td></tr>';
      }

      function renderContent() {
        if (payload.status === "idle") {
          contentEl.innerHTML = '<div class="empty">Run discover on a pipeline with schema changes, then open schema review from run details.</div>';
          return;
        }
        if (payload.error) {
          contentEl.innerHTML = '<div class="error">' + esc(payload.error) + '</div>';
        }
        const namespaces = (payload.state && payload.state.namespaces) || [];
        if (!namespaces.length) {
          contentEl.innerHTML = '<div class="empty">No schema changes recorded for the selected run.</div>';
          return;
        }
        const ns = namespaces.find(n => n.namespace === activeNamespace) || namespaces[0];
        const rows = ns.rows || [];
        if (!rows.length) {
          contentEl.innerHTML = '<div class="empty">No diff rows for namespace ' + esc(ns.namespace) + '.</div>';
          return;
        }
        contentEl.innerHTML =
          '<table><thead><tr><th>Kind</th><th>Field</th><th>Types</th><th>Decision</th></tr></thead><tbody>' +
          rows.map(renderRow).join("") + '</tbody></table>';
      }

      function render() {
        renderMeta();
        renderToolbar();
        renderTabs();
        renderContent();
      }

      document.addEventListener("click", event => {
        const target = event.target instanceof Element ? event.target : null;
        const actionBtn = target && target.closest("button[data-action]");
        if (actionBtn) {
          const action = actionBtn.getAttribute("data-action");
          if (action) {
            vscode.postMessage({ command: action, namespace: activeNamespace });
          }
          return;
        }
        const tab = target && target.closest(".tab[data-namespace]");
        if (tab) {
          activeNamespace = tab.getAttribute("data-namespace") || "";
          renderTabs();
          renderContent();
          return;
        }
        const decisionBtn = target && target.closest("button[data-decision]");
        if (decisionBtn) {
          const rowEl = decisionBtn.closest("tr[data-row]");
          const rowId = rowEl && rowEl.getAttribute("data-row");
          const decision = decisionBtn.getAttribute("data-decision");
          if (rowId && decision) {
            vscode.postMessage({ command: "setDecision", namespace: activeNamespace, rowId, decision });
          }
        }
      });

      document.addEventListener("change", event => {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement || target instanceof HTMLInputElement)) {
          return;
        }
        const rowId = target.getAttribute("data-row");
        const edit = target.getAttribute("data-edit");
        if (!rowId || !edit) {
          return;
        }
        vscode.postMessage({
          command: "editField",
          namespace: activeNamespace,
          rowId,
          edit,
          value: edit === "nullable" ? target.checked : target.value
        });
      });

      window.addEventListener("message", event => {
        if (!event.data || event.data.type !== "schemaDiffReview") {
          return;
        }
        payload = event.data;
        if (payload.activeNamespace) {
          activeNamespace = payload.activeNamespace;
        }
        render();
      });

      render();
    })();
  </script>
</body>
</html>`;
}
