// Isolated-world script: step-through "Log result in C3" wizard on a Bonzo prospect.
//
// Everything Input Results asks — the result, the loan officer, the lead
// source, the qualification questions and the lead card — asked here, on the
// Bonzo page, and logged through the same C3 path. The QUESTIONS are not
// hard-coded: the panel draws itself from /api/extension/outcome-options,
// which serves shared/lead-capture.ts, so a question changed in C3 changes
// here on the next open. Only the prospect id and what the CLR typed go to
// C3; the borrower's name and number are re-read from Bonzo by the server.
//
// Opened by content.js with a `c3:open-outcome` event carrying the prospect
// on screen. Nothing here talks to C3 directly — the background worker does.
(() => {
  if (window.__c3OutcomePanel) return;
  window.__c3OutcomePanel = true;

  const Z = "2147483001";
  let root = null;        // the panel element
  let options = null;     // cached /api/extension/outcome-options
  let ctx = null;         // { prospectId, fields, url }

  const el = (tag, style, text) => {
    const n = document.createElement(tag);
    if (style) Object.assign(n.style, style);
    if (text != null) n.textContent = text;
    return n;
  };
  const font = "500 13px/1.35 system-ui, -apple-system, sans-serif";
  const label = (t) => el("div", { font: "700 11px/1.2 system-ui, sans-serif", color: "#475569", margin: "10px 0 4px", textTransform: "uppercase", letterSpacing: ".04em" }, t);
  const input = (name, attrs = {}) => {
    const i = el("input", { width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: "8px", font, background: "#fff", color: "#0f172a" });
    i.name = name; Object.assign(i, attrs); return i;
  };
  const pill = (text, active) => {
    const b = el("button", { padding: "6px 10px", border: "1px solid " + (active ? "#0284c7" : "#cbd5e1"), borderRadius: "999px", background: active ? "#e0f2fe" : "#fff", color: "#0f172a", font: "600 12px/1 system-ui, sans-serif", cursor: "pointer" }, text);
    b.type = "button"; return b;
  };
  const row = () => el("div", { display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "2px" });

  // A group of pills that sets a hidden value; `values` is the form state.
  const pillGroup = (values, name, choices, labels) => {
    const r = row();
    const paint = () => Array.from(r.children).forEach((c, i) => {
      const on = values[name] === choices[i];
      c.style.background = on ? "#e0f2fe" : "#fff";
      c.style.borderColor = on ? "#0284c7" : "#cbd5e1";
    });
    choices.forEach((v, i) => {
      const b = pill(labels ? labels[i] : v, values[name] === v);
      b.onclick = () => { values[name] = values[name] === v ? "" : v; paint(); onChange(); };
      r.appendChild(b);
    });
    return r;
  };
  let onChange = () => {};

  const close = () => { if (root) { root.remove(); root = null; } };

  const send = (msg) => new Promise((resolve) => {
    try { chrome.runtime.sendMessage(msg, (resp) => resolve(chrome.runtime.lastError ? null : resp)); } catch { resolve(null); }
  });

  async function open(detail) {
    ctx = detail;
    close();
    root = el("div", {
      position: "fixed", top: "0", right: "0", height: "100vh", width: "min(440px, 100vw)", zIndex: Z,
      background: "#f8fafc", color: "#0f172a", boxShadow: "-12px 0 40px rgba(15,23,42,.25)",
      display: "flex", flexDirection: "column", font,
    });
    const head = el("div", { padding: "14px 16px", background: "linear-gradient(180deg,#0ea5e9,#0284c7)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between" });
    head.appendChild(el("div", { font: "800 15px/1.2 system-ui, sans-serif" }, "📋 Log result — step by step"));
    const x = el("button", { border: "none", background: "rgba(255,255,255,.15)", color: "#fff", borderRadius: "999px", width: "28px", height: "28px", cursor: "pointer", font: "700 14px/1 system-ui" }, "✕");
    x.type = "button"; x.onclick = close; head.appendChild(x);
    root.appendChild(head);
    const body = el("div", { padding: "12px 16px 24px", overflowY: "auto", flex: "1" });
    root.appendChild(body);
    document.body.appendChild(root);

    body.appendChild(el("div", { color: "#475569" }, "Loading the form from C3…"));
    if (!options) {
      const resp = await send({ type: "c3shotgun.options" });
      if (!resp || !resp.ok) {
        body.textContent = "";
        body.appendChild(el("div", { color: "#b91c1c", fontWeight: "700" }, resp && resp.status === 401
          ? "Not signed in to C3 — open C3 and log in, or paste your key in the extension popup."
          : "C3 didn't answer. Check your connection and try again."));
        return;
      }
      options = resp.body;
    }
    draw(body);
  }

  function draw(body) {
    body.textContent = "";
    const o = options;
    const values = { outcomeType: "", transferType: "", loId: "", appointmentDatetime: "", notes: "", bulkTexter: "", helperAssisted: "" };
    const capture = {};
    const f = ctx && ctx.fields;
    const who = (f && (f.fullName || [f.firstName, f.lastName].filter(Boolean).join(" "))) || "this prospect";

    body.appendChild(el("div", { font: "800 16px/1.2 system-ui, sans-serif", marginBottom: "2px" }, who));
    body.appendChild(el("div", { color: "#64748b", fontSize: "12px" }, [f && f.phone, f && f.state].filter(Boolean).join(" · ") || ("Bonzo prospect " + ctx.prospectId)));
    body.appendChild(el("div", { color: "#64748b", fontSize: "11px", marginTop: "2px" }, "Logged as " + (o.me.name || "you") + " for " + o.date));

    const progress = el("div", { display: "flex", gap: "3px", margin: "12px 0 6px" });
    body.appendChild(progress);
    const stepLabel = el("div", { font: "700 12px/1.2 system-ui, sans-serif", color: "#0369a1", marginBottom: "8px" });
    body.appendChild(stepLabel);

    const steps = [];
    const mkStep = (title, when) => {
      const s = el("div", { display: "none" });
      s.dataset.title = title;
      if (when) s.dataset.when = when;
      steps.push(s);
      body.appendChild(s);
      return s;
    };

    const sResult = mkStep("Result");
    sResult.appendChild(label("Result"));
    sResult.appendChild(pillGroup(values, "outcomeType", o.outcomeTypes.map((t) => t.value), o.outcomeTypes.map((t) => t.label)));
    const transferWrap = el("div");
    transferWrap.appendChild(label("Transfer type"));
    transferWrap.appendChild(pillGroup(values, "transferType", o.transferTypes.map((t) => t.value), o.transferTypes.map((t) => t.label)));
    sResult.appendChild(transferWrap);
    const apptWrap = el("div");
    apptWrap.appendChild(label("Appointment date & time"));
    const appt = input("appointmentDatetime", { type: "datetime-local" });
    appt.oninput = () => { values.appointmentDatetime = appt.value; };
    apptWrap.appendChild(appt);
    sResult.appendChild(apptWrap);

    const sLo = mkStep("Loan officer");
    sLo.appendChild(label("Loan officer"));
    const lo = el("select", { width: "100%", padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: "8px", font, background: "#fff" });
    const none = el("option", null, "— pick the loan officer —"); none.value = ""; lo.appendChild(none);
    o.los.forEach((l) => { const op = el("option", null, (l.assignedToday ? "★ " : "") + l.name); op.value = String(l.id); lo.appendChild(op); });
    lo.onchange = () => { values.loId = lo.value; };
    sLo.appendChild(lo);

    const sSource = mkStep("Lead source", "card");
    sSource.appendChild(label("Lead source"));
    sSource.appendChild(pillGroup(capture, "leadSource", [...o.leadSources, "other"], [...o.leadSources, "Other…"]));
    const other = input("leadSourceOther", { placeholder: "Which source?" });
    other.style.marginTop = "6px"; other.style.display = "none";
    other.oninput = () => { capture.leadSourceOther = other.value; };
    sSource.appendChild(other);

    const sQual = mkStep("Qualification", "card");
    sQual.appendChild(label("Qualification"));
    o.qualQuestions.forEach((q) => {
      sQual.appendChild(el("div", { fontSize: "12px", marginTop: "6px" }, q.label + (q.cue ? (" (" + q.cue + ")") : "")));
      if (q.hint) sQual.appendChild(el("div", { fontSize: "11px", color: "#b45309" }, q.hint));
      sQual.appendChild(pillGroup(capture, q.name, ["yes", "no"], ["Yes", "No"]));
    });

    const sections = [];
    o.infoFields.forEach((fld) => { if (!sections.includes(fld.section)) sections.push(fld.section); });
    sections.forEach((section) => {
      const sInfo = mkStep(section, "card");
      sInfo.appendChild(label(section));
      const toggle = (o.sectionToggles || []).find((t) => t.section === section);
      const fields = o.infoFields.filter((fld) => fld.section === section);
      const holder = el("div");
      if (toggle) {
        const t = el("label", { display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", margin: "4px 0 10px", cursor: "pointer", padding: "10px 12px", background: "#e2e8f0", borderRadius: "10px", fontWeight: "600" });
        const cb = el("input"); cb.type = "checkbox";
        cb.onchange = () => { capture[toggle.name] = cb.checked ? "yes" : ""; holder.style.display = cb.checked ? "none" : ""; };
        t.appendChild(cb); t.appendChild(el("span", null, toggle.label + " — skip this section"));
        sInfo.appendChild(t);
      }
      fields.forEach((fld) => {
        holder.appendChild(el("div", { fontSize: "12px", marginTop: "6px", color: "#334155" }, fld.label));
        if (fld.options) {
          holder.appendChild(pillGroup(capture, fld.name, [...fld.options]));
        } else {
          const i = input(fld.name, { type: fld.type || "text", placeholder: fld.placeholder || "", maxLength: fld.maxLength || 200 });
          if (fld.inputMode) i.inputMode = fld.inputMode;
          i.oninput = () => { capture[fld.name] = fld.digitsOnly ? i.value.replace(/\D/g, "") : i.value; if (fld.digitsOnly) i.value = capture[fld.name]; };
          holder.appendChild(i);
        }
        if (fld.notes) {
          const n = input(fld.notes, { placeholder: fld.notesPlaceholder || "Notes" });
          n.style.marginTop = "4px";
          n.oninput = () => { capture[fld.notes] = n.value; };
          holder.appendChild(n);
        }
      });
      sInfo.appendChild(holder);
    });

    const sExtras = mkStep("Transfer extras", "transfer");
    sExtras.appendChild(label("Was anyone else part of this transfer?"));
    sExtras.appendChild(el("div", { fontSize: "12px", marginTop: "4px" }, "Bulk texter"));
    sExtras.appendChild(pillGroup(values, "bulkTexter", ["yes", "no"], ["Yes", "No"]));
    sExtras.appendChild(el("div", { fontSize: "12px", marginTop: "6px" }, "Helper assisted (Elleine)"));
    sExtras.appendChild(pillGroup(values, "helperAssisted", ["yes", "no"], ["Yes", "No"]));

    const sNotes = mkStep("Notes");
    sNotes.appendChild(label("Other notes"));
    const notes = el("textarea", { width: "100%", boxSizing: "border-box", minHeight: "96px", padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: "8px", font, background: "#fff" });
    notes.placeholder = "Anything the LO should know that the card doesn't say";
    notes.oninput = () => { values.notes = notes.value; };
    sNotes.appendChild(notes);

    const sReview = mkStep("Submit");
    const reviewSummary = el("div", { color: "#334155", fontSize: "13px", marginBottom: "8px" });
    sReview.appendChild(reviewSummary);
    const msg = el("div", { marginTop: "8px", fontSize: "12px", minHeight: "16px", color: "#b91c1c" });
    const submit = el("button", { width: "100%", marginTop: "8px", padding: "12px", border: "none", borderRadius: "10px", background: "linear-gradient(180deg,#22c55e,#16a34a)", color: "#fff", font: "800 14px/1 system-ui, sans-serif", cursor: "pointer", display: "none" }, "Log it in C3");
    submit.type = "button";
    sReview.appendChild(msg); sReview.appendChild(submit);

    const nav = el("div", { display: "flex", gap: "8px", marginTop: "12px", position: "sticky", bottom: "0", background: "#f8fafc", paddingTop: "8px" });
    const back = el("button", { flex: "1", padding: "11px", border: "1px solid #cbd5e1", borderRadius: "10px", background: "#fff", font: "700 13px/1 system-ui", cursor: "pointer" }, "Back");
    back.type = "button";
    const next = el("button", { flex: "2", padding: "11px", border: "none", borderRadius: "10px", background: "linear-gradient(180deg,#0ea5e9,#0284c7)", color: "#fff", font: "800 13px/1 system-ui", cursor: "pointer" }, "Next");
    next.type = "button";
    nav.appendChild(back); nav.appendChild(next);
    body.appendChild(nav);

    let stepIdx = 0;

    const visibleSteps = () => {
      const t = values.outcomeType;
      return steps.filter((s) => {
        const when = s.dataset.when;
        if (when === "card") return t === "transfer" || t === "appointment";
        if (when === "transfer") return t === "transfer";
        return true;
      });
    };

    const validate = () => {
      const list = visibleSteps();
      const s = list[stepIdx];
      if (!s) return "Something went wrong.";
      if (s.dataset.title === "Result") {
        if (!values.outcomeType) return "Pick a result.";
        if (values.outcomeType === "transfer" && !values.transferType) return "Direct or appointment transfer?";
        if (values.outcomeType === "appointment" && !values.appointmentDatetime) return "Set the appointment date and time.";
      }
      if (s.dataset.title === "Loan officer" && !values.loId && values.outcomeType !== "appointment") return "Pick the loan officer.";
      return "";
    };

    const refresh = () => {
      const t = values.outcomeType;
      transferWrap.style.display = t === "transfer" ? "" : "none";
      apptWrap.style.display = t === "appointment" ? "" : "none";
      other.style.display = capture.leadSource === "other" ? "" : "none";
      const typeLabel = (o.outcomeTypes.find((x) => x.value === t) || {}).label || t;
      submit.textContent = t === "transfer" ? "Log the transfer in C3" : t ? ('Log "' + typeLabel + '" in C3') : "Log it in C3";
      const loRow = (o.los || []).find((l) => String(l.id) === String(values.loId));
      reviewSummary.textContent = "";
      reviewSummary.appendChild(el("div", { font: "700 14px/1.3 system-ui", marginBottom: "6px" }, "Ready to log"));
      reviewSummary.appendChild(el("div", null, "Result: " + (typeLabel || "—")));
      if (values.transferType) {
        const tl = (o.transferTypes.find((x) => x.value === values.transferType) || {}).label || values.transferType;
        reviewSummary.appendChild(el("div", null, "Transfer: " + tl));
      }
      if (loRow) reviewSummary.appendChild(el("div", null, "LO: " + loRow.name));
      if (capture.leadSource) reviewSummary.appendChild(el("div", null, "Source: " + (capture.leadSource === "other" ? (capture.leadSourceOther || "other") : capture.leadSource)));
    };

    const render = () => {
      const list = visibleSteps();
      if (stepIdx >= list.length) stepIdx = list.length - 1;
      if (stepIdx < 0) stepIdx = 0;
      steps.forEach((s) => { s.style.display = "none"; });
      const s = list[stepIdx];
      s.style.display = "";
      progress.textContent = "";
      list.forEach((_, i) => {
        progress.appendChild(el("div", { flex: "1", height: "4px", borderRadius: "2px", background: i <= stepIdx ? "#0284c7" : "#e2e8f0" }));
      });
      stepLabel.textContent = "Step " + (stepIdx + 1) + " of " + list.length + " — " + s.dataset.title;
      back.style.visibility = stepIdx === 0 ? "hidden" : "visible";
      const last = stepIdx === list.length - 1;
      next.style.display = last ? "none" : "";
      submit.style.display = last ? "" : "none";
      msg.textContent = "";
      refresh();
    };

    onChange = () => { refresh(); };
    back.onclick = () => { stepIdx -= 1; render(); };
    next.onclick = () => {
      const err = validate();
      if (err) { msg.textContent = err; return; }
      stepIdx += 1; render();
    };

    submit.onclick = async () => {
      msg.style.color = "#b91c1c"; msg.textContent = "";
      if (!values.outcomeType) { msg.textContent = "Pick a result."; return; }
      if (values.outcomeType === "transfer" && !values.transferType) { msg.textContent = "Direct or appointment transfer?"; return; }
      if (!values.loId && values.outcomeType !== "appointment") { msg.textContent = "Pick the loan officer."; return; }
      if (values.outcomeType === "appointment" && !values.appointmentDatetime) { msg.textContent = "Set the appointment date and time."; return; }
      submit.disabled = true; submit.textContent = "Logging…";
      const resp = await send({ type: "c3shotgun.outcome", payload: {
        prospectId: ctx.prospectId, url: ctx.url,
        outcomeType: values.outcomeType, transferType: values.transferType || null,
        loId: values.loId ? Number(values.loId) : null,
        appointmentDatetime: values.appointmentDatetime || null,
        notes: values.notes, bulkTexter: values.bulkTexter || null, helperAssisted: values.helperAssisted || null,
        capture,
      } });
      submit.disabled = false; refresh(); render();
      if (!resp) { msg.textContent = "Extension error — reload this tab and try again."; return; }
      if (!resp.ok) { msg.textContent = (resp.body && resp.body.error) || ("C3 error (HTTP " + (resp.status || "?") + ")"); return; }
      body.textContent = "";
      const c = resp.body.celebration;
      body.appendChild(el("div", { font: "800 20px/1.2 system-ui, sans-serif", marginTop: "24px", textAlign: "center" }, c ? c.headline : "✓ Logged in C3"));
      body.appendChild(el("div", { textAlign: "center", marginTop: "8px", color: "#334155" }, c ? c.message : (resp.body.borrowerName + (resp.body.loName ? " → " + resp.body.loName : ""))));
      if (c) body.appendChild(el("div", { textAlign: "center", marginTop: "6px", color: "#64748b", fontSize: "12px" }, c.dailyTotal + " today · " + c.monthlyTotal + " this month · #" + c.dailyRank + " today"));
      const done = el("button", { display: "block", margin: "20px auto 0", padding: "10px 18px", border: "none", borderRadius: "999px", background: "#0284c7", color: "#fff", font: "700 13px/1 system-ui", cursor: "pointer" }, "Done");
      done.type = "button"; done.onclick = close; body.appendChild(done);
    };

    render();
  }


  window.addEventListener("c3:open-outcome", (ev) => { open(ev.detail || {}); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && root) close(); });
})();
