/** Webview body for the Run sidebar status/history panel. */

import { buildSkipprRunDisplayScript } from "./skipprRunDisplay";
import { buildSyncMetricsChartScript, syncMetricsChartStyles } from "./skipprRunMetricsChart";

export function renderSkipprRunStatusPanelHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <style>
    body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font: 12px var(--vscode-font-family); }
    .section-title { height: 22px; padding: 0 8px; display: flex; align-items: center; border-top: 1px solid var(--vscode-panel-border); border-bottom: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); text-transform: uppercase; font-size: 10px; letter-spacing: .04em; }
    .summary { padding: 7px 8px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
    .line { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 18px; }
    .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .status-badge { flex-shrink: 0; display: inline-flex; align-items: center; min-height: 16px; padding: 0 5px; border: 1px solid var(--vscode-panel-border); font-size: 10px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
    .status-badge.running { color: var(--vscode-textLink-foreground); border-color: var(--vscode-textLink-foreground); }
    .status-badge.success { color: var(--vscode-testing-iconPassed); border-color: var(--vscode-testing-iconPassed); }
    .status-badge.error { color: var(--vscode-errorForeground); border-color: var(--vscode-errorForeground); }
    .status-badge.stopped { color: var(--vscode-editorWarning-foreground); border-color: var(--vscode-editorWarning-foreground); }
    .status-badge.idle { color: var(--vscode-descriptionForeground); }
    .meta { margin-top: 2px; color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
    .kv { display: grid; grid-template-columns: 86px 1fr; gap: 4px 8px; margin-top: 7px; font-size: 11px; }
    .key { color: var(--vscode-descriptionForeground); }
    .value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .model-list { margin-top: 7px; display: flex; flex-direction: column; gap: 3px; }
    .model-file { color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .status-ok { color: var(--vscode-testing-iconPassed); }
    .status-bad { color: var(--vscode-errorForeground); }
    button.run { all: unset; box-sizing: border-box; width: 100%; min-height: 30px; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); cursor: pointer; }
    button.run:hover { background: var(--vscode-list-hoverBackground); }
    .empty { padding: 8px; color: var(--vscode-descriptionForeground); }
    .run-actions { padding: 0 8px 8px; }
    button.cancel-run {
      all: unset; box-sizing: border-box; display: inline-flex; align-items: center; min-height: 22px; padding: 2px 10px;
      border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
      background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
      cursor: pointer; font-size: 11px; font-weight: 600;
    }
    button.cancel-run:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .run-notice {
      margin: 0 8px 8px; padding: 6px 8px; border-left: 2px solid var(--vscode-editorWarning-foreground);
      color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.45;
    }
    .run-notice-compact { margin-top: 0; }
    .lock-panel { padding: 7px 8px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
    .lock-panel.lock-blocking { border-left: 3px solid var(--vscode-editorWarning-foreground); background: color-mix(in srgb, var(--vscode-inputValidation-warningBackground) 40%, transparent); }
    .lock-panel.lock-failed { border-left: 3px solid var(--vscode-errorForeground); background: color-mix(in srgb, var(--vscode-inputValidation-errorBackground) 45%, transparent); }
    .lock-panel.lock-idle { border-left: 3px solid var(--vscode-descriptionForeground); }
    .lock-actions { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
    button.lock-refresh { all: unset; color: var(--vscode-textLink-foreground); cursor: pointer; font-size: 11px; }
    button.lock-refresh:hover { text-decoration: underline; }
    .lock-run-id { font-family: var(--vscode-editor-font-family); font-size: 10px; }
    .section-title-row { height: 22px; padding: 0 8px; display: flex; align-items: center; gap: 5px; border-top: 1px solid var(--vscode-panel-border); border-bottom: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); text-transform: uppercase; font-size: 10px; letter-spacing: .04em; }
    .info-tip {
      display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; flex-shrink: 0;
      border-radius: 50%; border: 1px solid var(--vscode-descriptionForeground); color: var(--vscode-descriptionForeground);
      font-size: 10px; font-weight: 700; line-height: 1; cursor: help; text-transform: none; letter-spacing: 0;
    }
    ${syncMetricsChartStyles()}
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
    (function () {
      const vscode = acquireVsCodeApi();
      const root = document.getElementById("root");
      let showingObservedRun = false;
      ${buildSkipprRunDisplayScript()}
      ${buildSyncMetricsChartScript()}
      function esc(v) {
        return String(v == null ? "" : v).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
      }
      function num(v) {
        return typeof v === "number" ? v.toLocaleString() : "0";
      }
      function elapsedMs(run) {
        if (typeof run.elapsedMs === "number") {
          return run.elapsedMs;
        }
        if (typeof run.startedAt === "number") {
          const end = typeof run.finishedAt === "number" ? run.finishedAt : Date.now();
          return Math.max(0, end - run.startedAt);
        }
        return 0;
      }
      function duration(run) {
        const ms = elapsedMs(run);
        return (ms / 1000).toFixed(ms > 10000 ? 0 : 1) + "s";
      }
      function isModelRun(run) {
        const kind = String((run && (run.runKind || run.command)) || "");
        return kind === "model" || kind.startsWith("model");
      }
      function isSyncRun(run) {
        const kinds = { sync: 1, "sync-once": 1, "sync-all-once": 1 };
        const runKind = String((run && run.runKind) || "").trim();
        const command = String((run && run.command) || "").trim();
        return Boolean(kinds[runKind] || kinds[command]);
      }
      function statusLabel(status) {
        switch (status) {
          case "running": return "Running";
          case "success": return "Success";
          case "error": return "Failed";
          case "stopped": return "Stopped";
          case "idle": return "Idle";
          default: return status ? String(status) : "Idle";
        }
      }
      function statusBadge(status) {
        const value = status || "idle";
        return '<span class="status-badge ' + esc(value) + '">' + esc(statusLabel(value)) + '</span>';
      }
      function runMeta(run) {
        if (isModelRun(run)) {
          const files = modelFileCount(run);
          const preflight = run.modelPreflight ? (run.modelPreflight.ok ? "dbt ok" : "dbt blocked") : "dbt pending";
          const phase = runPhaseHint(run) || currentModelPhaseFromEvents(run) || "starting";
          return esc([duration(run), phase, preflight, "files " + files].join(" · "));
        }
        const parts = [duration(run)];
        const phase = runPhaseHint(run);
        if (phase) { parts.push(phase); }
        parts.push("rows " + num(run.totalRows != null ? run.totalRows : run.rowsWritten));
        return esc(parts.join(" · "));
      }
      function renderSyncChart(run, options) {
        if (!isSyncRun(run)) {
          return "";
        }
        const opts = options || {};
        const frozen = opts.frozen != null ? Boolean(opts.frozen) : run.status !== "running";
        return buildLiveSyncChart(run.metricPoints, { height: opts.height, maxSamples: opts.maxSamples, compact: opts.compact, frozen });
      }
      function modelRunDetails(run) {
        const pre = run.modelPreflight || {};
        const preStatus = pre.ok === true ? '<span class="status-ok">ok</span>' : pre.ok === false ? '<span class="status-bad">failed</span>' : 'pending';
        const validation = run.modelValidation || {};
        const valStatus = validation.ok === true ? '<span class="status-ok">ok</span>' : validation.ok === false ? '<span class="status-bad">failed</span>' : 'not run';
        const phase = run.phase || currentModelPhaseFromEvents(run) || "starting";
        const repair = run.modelRepairStatus || "none";
        const revision = run.modelPendingPlanRevision ? "pending" : "none";
        const files = (run.modelChangedFiles || []).slice(0, 8).map(file => {
          const label = file.path || file.absolute_path || "changed file";
          const kind = file.change_kind ? " [" + file.change_kind + "]" : "";
          return '<div class="model-file">' + esc(label + kind) + '</div>';
        }).join("");
        return '<div class="kv">' +
          '<div class="key">Phase</div><div class="value">' + esc(phase) + '</div>' +
          '<div class="key">Repair</div><div class="value">' + esc(repair) + '</div>' +
          '<div class="key">Plan</div><div class="value">' + esc(revision) + '</div>' +
          '<div class="key">dbt</div><div class="value">' + preStatus + (pre.command ? ' · ' + esc(pre.command) : '') + '</div>' +
          '<div class="key">Validation</div><div class="value">' + valStatus + (validation.message ? ' · ' + esc(validation.message) : '') + '</div>' +
          (pre.remediation ? '<div class="key">Fix</div><div class="value" title="' + esc(pre.remediation) + '">' + esc(pre.remediation) + '</div>' : '') +
        '</div>' + (files ? '<div class="model-list">' + files + '</div>' : '');
      }
      function currentModelPhaseFromEvents(run) {
        const events = run.events || [];
        for (let i = events.length - 1; i >= 0; i--) {
          if (events[i].phase) { return events[i].phase; }
        }
        return "";
      }
      function modelFileCount(run) {
        const summary = run.modelFileSummary || {};
        return Number(summary.total_count || (run.modelChangedFiles || []).length || 0);
      }
      function renderRunControls(run, payload) {
        if (!run || run.status !== "running") {
          return "";
        }
        if (payload && payload.localProcessActive) {
          return '<div class="run-actions"><button type="button" class="cancel-run" data-action="cancelRun">Cancel run</button></div>';
        }
        if (payload && payload.orphanLockReleaseAvailable) {
          return '<div class="run-actions"><button type="button" class="cancel-run" data-action="cancelRun">Release lock</button>' +
            infoTip("No local CLI in this window. Release only if nothing is still syncing on CI or another machine.") +
            "</div>";
        }
        return "";
      }
      function renderCurrent(run, payload) {
        if (!run) {
          return '<div class="section-title">Current Run</div><div class="empty">No active Skippr run.</div>';
        }
        return '<div class="section-title">Current Run</div><div class="summary">' +
          '<div class="line"><span class="name">' + esc(runTitle(run)) + '</span>' + statusBadge(run.status) + '</div>' +
          '<div class="meta">' + runMeta(run) + '</div>' +
          (isModelRun(run) ? modelRunDetails(run) : renderSyncChart(run, { height: 48, compact: false, frozen: run.status !== "running" })) +
        '</div>' + renderRunControls(run, payload);
      }
      function shortRunId(runId) {
        const id = String(runId || "");
        return id.length > 12 ? id.slice(0, 8) + "…" : id;
      }
      function infoTip(text) {
        const t = esc(text);
        return '<span class="info-tip" tabindex="0" role="img" aria-label="' + t + '" title="' + t + '">?</span>';
      }
      function cloudLockSectionTitle(ws) {
        let tip = "";
        if (ws && ws.lock) {
          if (ws.blocking) {
            tip = "This cloud lock blocks new discover/sync/model runs in this workspace.";
          } else {
            const status = String(ws.lock.status || "").toLowerCase();
            if (status === "failed" || status === "error") {
              tip = "Run failed. Lock does not block new runs; you can start discover/sync/model again.";
            } else {
              tip = "Lock is not blocking (terminal status or lease expired). New runs should be allowed.";
            }
          }
        }
        return '<div class="section-title-row">Cloud workspace lock' + (tip ? infoTip(tip) : "") + "</div>";
      }
      function lockPanelClass(lock, blocking) {
        if (blocking) {
          return "lock-panel lock-blocking";
        }
        const status = String(lock.status || "").toLowerCase();
        if (status === "failed" || status === "error") {
          return "lock-panel lock-failed";
        }
        if (status === "running") {
          return "lock-panel lock-blocking";
        }
        return "lock-panel lock-idle";
      }
      function lockStatusBadge(lock, blocking) {
        if (blocking) {
          return statusBadge("running");
        }
        const status = String(lock.status || "").toLowerCase();
        if (status === "failed" || status === "error") {
          return statusBadge("error");
        }
        return statusBadge(status || "idle");
      }
      function lockFooterNote(lock, workspace, blocking) {
        if (blocking) {
          return '<div class="lock-actions"><button type="button" class="cancel-run" data-action="releaseCloudLock" data-workspace="' + esc(workspace) + '" data-run-id="' + esc(lock.runId) + '">Release lock</button></div>';
        }
        return "";
      }
      function renderWorkspaceLock(ws) {
        const state = ws || { signedIn: false, blocking: false };
        let body = "";
        if (!state.signedIn) {
          body = '<div class="empty">Sign in (or use skippr user login) to view cloud workspace locks.</div>';
        } else if (state.loadError) {
          body = '<div class="run-notice run-notice-compact">' + esc(state.loadError) + '</div>';
        } else if (!state.lock) {
          body = '<div class="empty">No lock on workspace “' + esc(state.workspace || "") + '”. You can start discover, sync, or model.</div>';
        } else {
          const lock = state.lock;
          const pipe = lock.pipeline ? " · " + esc(lock.pipeline) : "";
          const lease = lock.leaseExpiresAt ? esc(lock.leaseExpiresAt) : "—";
          const blocking = Boolean(state.blocking);
          body = '<div class="' + lockPanelClass(lock, blocking) + '">' +
            '<div class="line"><span class="name">' + esc(state.workspace || "") + '</span>' + lockStatusBadge(lock, blocking) + '</div>' +
            '<div class="meta">' + esc(lock.command + pipe) + ' · run <span class="lock-run-id">' + esc(shortRunId(lock.runId)) + '</span></div>' +
            '<div class="kv">' +
            '<div class="key">Status</div><div class="value">' + esc(lock.status) + (lock.cancelRequested ? " (cancel requested)" : "") + '</div>' +
            '<div class="key">Lease</div><div class="value" title="' + lease + '">' + lease + '</div>' +
            '</div>' +
            lockFooterNote(lock, state.workspace, blocking) +
            '</div>';
        }
        return cloudLockSectionTitle(state) + body +
          '<div class="lock-actions" style="padding:0 8px 8px"><button type="button" class="lock-refresh" data-action="refreshWorkspaceLock">Refresh</button></div>';
      }
      function renderHistory(history) {
        const rows = (history || []).map(run =>
          '<button class="run" data-run-id="' + esc(run.id) + '"><div class="line"><span class="name">' + esc(runTitle(run)) + '</span>' + statusBadge(run.status) + '</div>' +
          '<div class="meta">' + runMeta(run) + '</div>' + renderSyncChart(run, { height: 36, compact: true, frozen: true }) + '</button>'
        ).join("");
        return '<div class="section-title">Previous Runs</div>' + (rows || '<div class="empty">No saved runs yet.</div>');
      }
      function render(m) {
        if (m.type === "status") {
          if (showingObservedRun && (!m.phase || m.phase === "idle")) {
            return;
          }
          showingObservedRun = false;
          root.innerHTML = '<div class="section-title">Current Run</div><div class="summary"><div class="line"><span class="name">' + esc(m.headline || "No Skippr run yet.") + '</span>' + statusBadge(m.phase || "idle") + '</div><div class="meta">' + esc(m.detail || "") + '</div></div>';
          return;
        }
        if (m.type === "observability") {
          showingObservedRun = Boolean(m.current);
          root.innerHTML = renderWorkspaceLock(m.workspaceLock) + renderCurrent(m.current, m) + renderHistory(m.history);
        }
      }
      root.addEventListener("click", event => {
        const release = event.target.closest("button[data-action='releaseCloudLock']");
        if (release) {
          vscode.postMessage({
            command: "releaseCloudLock",
            workspace: release.dataset.workspace,
            runId: release.dataset.runId
          });
          return;
        }
        const refreshLock = event.target.closest("button[data-action='refreshWorkspaceLock']");
        if (refreshLock) {
          vscode.postMessage({ command: "refreshWorkspaceLock" });
          return;
        }
        const cancel = event.target.closest("button[data-action='cancelRun']");
        if (cancel) {
          vscode.postMessage({ command: "cancelRun" });
          return;
        }
        const button = event.target.closest("button[data-run-id]");
        if (button) {
          vscode.postMessage({ command: "openRun", runId: button.dataset.runId });
        }
      });
      window.addEventListener("message", function (e) {
        var d = e.data;
        if (d && (d.type === "status" || d.type === "observability")) { render(d); }
      });
    })();
  </script>
</body>
</html>`;
}
