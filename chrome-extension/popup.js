const statusEl = document.getElementById("status");
const keyEl = document.getElementById("key");
const savedEl = document.getElementById("saved");
const seenEl = document.getElementById("seen");
const builtEl = document.getElementById("built");

function refreshStatus() {
  statusEl.className = "wait";
  statusEl.textContent = "Checking connection…";
  chrome.runtime.sendMessage({ type: "c3shotgun.status" }, (resp) => {
    if (chrome.runtime.lastError || !resp) {
      statusEl.className = "warn";
      statusEl.textContent = "Extension error — try reopening this popup.";
      return;
    }
    if (resp.ok && resp.body) {
      const calls = Number(resp.body.bonzoCallsToday);
      const contacts = Number(resp.body.bonzoContactsToday);
      const convos = Number(resp.body.bonzoConversationsToday);
      const parts = [];
      if (Number.isFinite(calls)) parts.push(`${calls} Bonzo call${calls === 1 ? "" : "s"}`);
      if (Number.isFinite(contacts)) parts.push(`${contacts} contact${contacts === 1 ? "" : "s"} viewed`);
      if (Number.isFinite(convos)) parts.push(`${convos} convo${convos === 1 ? "" : "s"} viewed`);
      const countsNote = parts.length ? ` · ${parts.join(" · ")} today` : "";
      if (resp.body.canPublish) {
        statusEl.className = "ok";
        statusEl.textContent = `Connected as ${resp.body.name || "you"} — ready to log results ✓${countsNote}`;
      } else {
        statusEl.className = "warn";
        statusEl.textContent = `Connected as ${resp.body.name || "you"}, but you don't have Shotgun publish access. You can still log results.${countsNote}`;
      }
    } else if (resp.status === 401) {
      statusEl.className = "warn";
      statusEl.textContent = "Not connected. Log in to C3 in this browser, or paste your extension key below.";
    } else {
      statusEl.className = "warn";
      statusEl.textContent = (resp.body && resp.body.error) || `C3 error (HTTP ${resp.status || "?"}).`;
    }
  });
}

chrome.storage.local.get("c3Key").then((stored) => {
  if (stored.c3Key) keyEl.value = String(stored.c3Key);
});

chrome.storage.local.get("c3Seen").then((stored) => {
  const seen = stored && stored.c3Seen;
  if (!seenEl) return;
  if (!seen) {
    seenEl.textContent = "No Bonzo tab seen yet. Open a prospect in Bonzo, then reopen this popup.";
    return;
  }
  const age = Math.max(0, Math.round((Date.now() - Number(seen.at || 0)) / 1000));
  const when = age < 90 ? `${age}s ago` : `${Math.round(age / 60)}m ago`;
  seenEl.textContent = seen.id
    ? `Prospect ${seen.id} detected (${when}).`
    : `On a Bonzo page ${when}, but no prospect id in the address. Open a single prospect, not a list.`;
});

document.getElementById("save").addEventListener("click", () => {
  chrome.storage.local.set({ c3Key: keyEl.value.trim() }).then(() => {
    savedEl.style.display = "block";
    setTimeout(() => { savedEl.style.display = "none"; }, 2000);
    refreshStatus();
  });
});

try {
  fetch(chrome.runtime.getURL("manifest.json"))
    .then((r) => r.json())
    .then((m) => {
      const d = String(m.description || "");
      const match = d.match(/\(built for ([^)]+)\)/);
      if (builtEl) builtEl.textContent = match
        ? `Built for ${match[1]} · v${m.version}`
        : `Extension v${m.version}`;
    })
    .catch(() => {});
} catch {}

refreshStatus();
