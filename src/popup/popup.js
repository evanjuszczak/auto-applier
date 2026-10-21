const STORAGE_KEY = "hsQuickApply";
const CONTENT_SCRIPT_FILES = [
  "src/config/selectors.js",
  "src/content/dom-utils.js",
  "src/content/classifier.js",
  "src/content/runner.js",
  "src/content/content.js"
];
const $ = (id) => document.getElementById(id);

function updateStartLabel() {
  $("start").textContent = $("live-submit").checked ? "Start live apply" : "Start dry-run";
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isHandshakeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "joinhandshake.com" || url.hostname.endsWith(".joinhandshake.com"));
  } catch {
    return false;
  }
}

async function ping(tabId) {
  return chrome.tabs.sendMessage(tabId, { action: "ping" });
}

async function connect(tabId) {
  try {
    const response = await ping(tabId);
    if (response?.success && response.ready) return;
  } catch {
    // A missing receiver is expected when this tab predates extension installation/reload.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: CONTENT_SCRIPT_FILES
    });
    const response = await ping(tabId);
    if (response?.success && response.ready) return;
    throw new Error("The Handshake page did not initialize the extension receiver.");
  } catch (error) {
    throw new Error(
      `Could not connect to the Handshake tab. Reload the extension at chrome://extensions, ` +
      `refresh the Handshake tab, and try again. (${error.message})`
    );
  }
}

async function send(action, settings) {
  const tab = await activeTab();
  if (!tab?.id || !isHandshakeUrl(tab.url)) {
    throw new Error("Open a Handshake job search page first.");
  }
  await connect(tab.id);
  return chrome.tabs.sendMessage(tab.id, { action, settings });
}

function render(state = {}) {
  const counts = state.counts || {};
  $("summary").textContent =
    `Applied: ${counts.applied || 0} · Skipped: ${counts.skipped || 0} · ` +
    `Errors: ${counts.errors || 0} · Would apply: ${counts.dryRun || 0}`;
  const missing = state.missingSelectors || [];
  $("missing-warning").hidden = missing.length === 0;
  $("missing-list").replaceChildren(...missing.map((name) => {
    const item = document.createElement("li");
    item.textContent = name;
    return item;
  }));
  const status = state.status || "idle";
  const reason = state.finishReason || state.haltReason;
  const progress = status === "running" || status === "paused"
    ? ` · ${counts.applied || 0} submitted / ${state.maxApplications || 25} max`
    : "";
  $("page-status").textContent = `Status: ${status}${progress}${reason ? ` — ${reason}` : ""}`;
  const entries = (state.log || []).slice(-50).reverse();
  $("log").replaceChildren(...entries.map((entry) => {
    const item = document.createElement("li");
    item.textContent = `${entry.title || "(untitled)"} — ${entry.decision}: ${entry.reason}`;
    return item;
  }));
}

async function refresh() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const state = stored[STORAGE_KEY] || {};
  if (!state.missingSelectors?.length) {
    state.missingSelectors = window.HSQuickApply.missingRequiredSelectors();
  }
  render(state);
}

function settings() {
  return {
    maxApplications: $("max-applications").value,
    minDelayMs: $("min-delay").value,
    maxDelayMs: $("max-delay").value,
    listMode: $("list-mode").value,
    dryRun: !$("live-submit").checked
  };
}

for (const [id, action] of [
  ["start", "start"],
  ["pause", "pause"],
  ["resume", "resume"],
  ["stop", "stop"]
]) {
  $(id).addEventListener("click", async () => {
    if (action === "start" && $("live-submit").checked &&
      !window.confirm(
        "This will submit eligible Handshake applications using your selected resume. " +
        "Only resume-only in-platform applications will be submitted. Continue?"
      )) {
      return;
    }
    $("page-status").textContent = "Status: sending command...";
    try {
      const response = await send(action, settings());
      if (!response?.success && response?.missing) {
        render({ ...(await currentState()), missingSelectors: response.missing });
      } else if (!response?.success) {
        $("page-status").textContent = `Error: ${response?.error || "Unable to start."}`;
      }
      await refresh();
    } catch (error) {
      $("page-status").textContent = `Error: ${error.message}`;
    }
  });
}

$("live-submit").addEventListener("change", updateStartLabel);
updateStartLabel();

async function currentState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY] || {};
}

$("export").addEventListener("click", async () => {
  const state = await currentState();
  const columns = ["id", "title", "company", "url", "decision", "reason", "timestamp"];
  const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [columns.join(","), ...(state.log || []).map((entry) =>
    columns.map((column) => escape(entry[column])).join(",")
  )].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "handshake-quick-apply-log.csv";
  link.click();
  URL.revokeObjectURL(url);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) render(changes[STORAGE_KEY].newValue);
});

activeTab().then((tab) => {
  $("page-status").textContent = isHandshakeUrl(tab?.url)
    ? "Handshake tab ready."
    : "Open a Handshake job search page first.";
  return refresh();
}).catch((error) => {
  $("page-status").textContent = `Error: ${error.message}`;
});
