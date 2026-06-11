/**
 * Email Module — Daily Brief
 * AI-powered email triage and morning summaries.
 * Integrates via: iCloud IMAP, Gmail API, or manual entry.
 */

import { refs, dbSet, dbDelete, uid } from "../js/db.js";
import { callAI } from "../js/ai.js";

let _container = null;
let _ctx = null;
let _stateUnsub = null;
let _localState = {
  view: "brief",     // "brief" | "triage" | "setup"
  generating: false,
  showAddThread: false,
};

const tod = () => new Date().toISOString().slice(0, 10);
const escH = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;");

const PRIORITY_LABELS = {
  critical: { label:"🔴 Critical", col:"var(--color-red)",    bg:"var(--color-red-bg)" },
  high:     { label:"🟠 High",     col:"var(--color-orange)", bg:"var(--color-orange-bg)" },
  medium:   { label:"🟡 Medium",   col:"var(--color-yellow)", bg:"var(--color-yellow-bg)" },
  low:      { label:"⚪ Low",      col:"var(--text-tertiary)", bg:"var(--bg-surface-2)" },
};

function render() {
  if (!_container || !_ctx) return;
  const { emailBriefs } = _ctx.state();
  const todayBrief = emailBriefs.find(b => b.date === tod());

  _container.innerHTML = `
    <div class="module-content">

      <!-- Tabs -->
      <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-4);overflow-x:auto">
        ${["brief","triage","setup"].map(v=>`
          <button class="btn btn-sm ${_localState.view===v?"btn-primary":"btn-secondary"}" data-view="${v}" style="flex-shrink:0">
            ${{brief:"📰 Daily Brief",triage:"📥 Triage",setup:"⚙️ Setup"}[v]}
          </button>
        `).join("")}
      </div>

      ${_localState.view === "brief"  ? renderBrief(todayBrief, emailBriefs) : ""}
      ${_localState.view === "triage" ? renderTriage() : ""}
      ${_localState.view === "setup"  ? renderSetup() : ""}
    </div>
  `;

  bindEvents();
}

function renderBrief(todayBrief, allBriefs) {
  return `
    <div style="display:flex;flex-direction:column;gap:var(--space-4)">

      <!-- Today's brief -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">📰 Today's email brief</div>
          <button class="btn btn-primary btn-sm" id="gen-brief-btn">
            ${_localState.generating ? `<span class="spinner-sm"></span> Generating…` : "✨ Generate"}
          </button>
        </div>
        ${todayBrief ? `
          <div style="padding:var(--space-4)">
            <div style="font-size:var(--text-xs);color:var(--text-tertiary);margin-bottom:var(--space-2)">Generated ${new Date().toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}</div>
            <div style="font-size:var(--text-md);line-height:1.8;color:var(--text-primary)">${todayBrief.summary}</div>
            ${todayBrief.actions?.length ? `
              <div style="margin-top:var(--space-4)">
                <div class="section-label">Action items</div>
                ${todayBrief.actions.map(a=>`
                  <div style="display:flex;align-items:flex-start;gap:var(--space-2);padding:var(--space-2) 0;border-bottom:1px solid var(--separator)">
                    <input type="checkbox" style="margin-top:2px;accent-color:var(--accent)">
                    <div style="font-size:var(--text-sm)">${escH(a)}</div>
                  </div>
                `).join("")}
              </div>
            ` : ""}
          </div>
        ` : `
          <div style="padding:var(--space-5);text-align:center">
            <div style="font-size:32px;margin-bottom:var(--space-2)">📧</div>
            <div style="font-size:var(--text-md);font-weight:700;margin-bottom:var(--space-2)">No brief yet for today</div>
            <div style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:var(--space-4)">
              Paste in a summary of your emails and Claude will triage and brief you.
            </div>
            <button class="btn btn-primary" id="gen-brief-btn">✨ Generate brief</button>
          </div>
        `}
      </div>

      <!-- Paste area -->
      <div class="card">
        <div style="padding:var(--space-4)">
          <div style="font-weight:700;margin-bottom:var(--space-2)">📋 Paste email content</div>
          <div style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:var(--space-3)">
            Paste your inbox snapshot or email subjects here. Claude will summarize and prioritize.
          </div>
          <textarea id="email-paste" class="input" placeholder="Paste email subjects, senders, and snippets here…" style="min-height:120px;margin-bottom:var(--space-3)"></textarea>
          <button class="btn btn-primary w-full" id="process-emails-btn">
            ${_localState.generating ? `<span class="spinner-sm"></span> Processing…` : "✨ Process with AI"}
          </button>
        </div>
      </div>

      <!-- Recent briefs -->
      ${allBriefs.length > 1 ? `
        <div class="section-title">Past briefs</div>
        <div class="card">
          ${allBriefs.slice(0,5).map(b=>`<div class="list-row list-row--clickable">
            <div style="flex:1">
              <div style="font-weight:600;font-size:var(--text-sm)">${b.date}</div>
              <div style="font-size:var(--text-xs);color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escH((b.summary||"").slice(0,80))}…</div>
            </div>
            <button class="btn" style="font-size:12px;color:var(--text-tertiary)" data-del-brief="${b.id}">✕</button>
          </div>`).join("")}
        </div>
      ` : ""}
    </div>
  `;
}

function renderTriage() {
  const SAMPLE_THREADS = [
    { id:"t1", from:"boss@work.com", subject:"Q3 planning meeting", priority:"high", snippet:"Can we find time to sync this week on Q3 goals?", action:"Reply to schedule" },
    { id:"t2", from:"school@district.edu", subject:"Field trip permission", priority:"medium", snippet:"Please sign and return by Friday…", action:"Sign and return" },
    { id:"t3", from:"amazon@orders.com", subject:"Your order has shipped", priority:"low", snippet:"Your package will arrive by Thursday", action:"No action needed" },
  ];

  return `
    <div style="display:flex;flex-direction:column;gap:var(--space-4)">
      <div class="card">
        <div class="card-header">
          <div class="card-title">📥 Email triage</div>
          <button class="btn btn-secondary btn-sm" id="add-thread-btn">+ Add</button>
        </div>
        ${SAMPLE_THREADS.map(t => {
          const p = PRIORITY_LABELS[t.priority] || PRIORITY_LABELS.low;
          return `
            <div class="list-row">
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:2px">
                  <span class="pill" style="background:${p.bg};color:${p.col}">${p.label}</span>
                  <span style="font-size:var(--text-xs);color:var(--text-tertiary)">${t.from}</span>
                </div>
                <div style="font-weight:700;font-size:var(--text-sm)">${escH(t.subject)}</div>
                <div style="font-size:var(--text-xs);color:var(--text-secondary);margin-top:2px">${escH(t.snippet)}</div>
                ${t.action?`<div style="font-size:var(--text-xs);font-weight:700;color:var(--accent);margin-top:4px">→ ${t.action}</div>`:""}
              </div>
              <button class="btn btn-secondary btn-sm">✓ Done</button>
            </div>
          `;
        }).join("")}
      </div>

      <div class="card" style="border:1.5px solid var(--accent)">
        <div style="padding:var(--space-4)">
          <div style="font-weight:700;margin-bottom:var(--space-2)">✨ AI triage tip</div>
          <div style="font-size:var(--text-sm);color:var(--text-secondary);line-height:1.6">
            Paste your inbox subject lines in the Brief tab and Claude will auto-sort by priority and suggest actions. Works best first thing in the morning.
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderSetup() {
  const INTEGRATIONS = [
    { name:"iCloud Mail",   status:"Coming soon", icon:"📧", desc:"Connect via IMAP with App-Specific Password" },
    { name:"Gmail",         status:"Coming soon", icon:"📬", desc:"OAuth integration via Google API" },
    { name:"Apple Shortcuts",status:"Available",  icon:"🍎", desc:"Use Shortcuts to forward email summaries to Firebase" },
    { name:"Paste & brief", status:"✅ Active",   icon:"📋", desc:"Manually paste email content for AI triage" },
  ];

  return `
    <div style="display:flex;flex-direction:column;gap:var(--space-4)">
      <div class="card">
        <div class="card-header"><div class="card-title">⚙️ Email integrations</div></div>
        ${INTEGRATIONS.map(i=>`
          <div class="list-row">
            <span style="font-size:24px">${i.icon}</span>
            <div style="flex:1;min-width:0">
              <div style="font-weight:700;font-size:var(--text-sm)">${i.name}</div>
              <div style="font-size:var(--text-xs);color:var(--text-secondary)">${i.desc}</div>
            </div>
            <span class="pill" style="background:${i.status.includes("✅")?"var(--color-green-bg)":"var(--bg-surface-2)"};color:${i.status.includes("✅")?"var(--color-green)":"var(--text-tertiary)"};flex-shrink:0">
              ${i.status}
            </span>
          </div>
        `).join("")}
      </div>

      <div class="card">
        <div style="padding:var(--space-4)">
          <div style="font-weight:700;margin-bottom:var(--space-2)">📱 Shortcuts method (recommended)</div>
          <div style="font-size:var(--text-sm);color:var(--text-secondary);line-height:1.8">
            <strong>Steps:</strong><br>
            1. Open Shortcuts on iPhone/Mac<br>
            2. Create automation: "Daily at 7am"<br>
            3. Action: Get recent emails (last 24h)<br>
            4. Action: Get Content of URL → POST to Firebase<br><br>
            This gives you a daily digest in the Brief tab without storing full emails.
          </div>
        </div>
      </div>
    </div>
  `;
}

function bindEvents() {
  if (!_container) return;
  const $ = id => document.getElementById(id);
  const on = (id, ev, fn) => { const el=$(id); if(el) el.addEventListener(ev, fn); };

  _container.querySelectorAll("[data-view]").forEach(btn=>btn.addEventListener("click",()=>{_localState.view=btn.dataset.view;render();}));

  on("process-emails-btn","click",async()=>{
    const content=$("email-paste")?.value?.trim();
    if(!content||_localState.generating)return;
    _localState.generating=true;render();

    const prompt=`You are a personal chief of staff for Michael (family man, dad, professional). Triage these emails and write a concise morning brief (2-3 sentences summary, then 3-5 bullet action items). Be direct and practical. Format: first write the summary paragraph, then write "ACTION ITEMS:" followed by bullet points.\n\nEmails:\n${content}`;
    const raw=await callAI(prompt,{maxTokens:400})||"";
    const [summaryPart, actionsPart] = raw.split("ACTION ITEMS:");
    const summary = summaryPart?.trim() || "AI processing not available. Add your API key to enable smart email triage.";
    const actions = (actionsPart||"").split("\n").map(l=>l.replace(/^[-•*]\s*/,"").trim()).filter(Boolean);

    const brief={id:uid(),date:tod(),summary,actions,rawContent:content.slice(0,500)};
    await dbSet(refs.emailBrief(brief.id), brief);
    _localState.generating=false;
    render();
  });

  _container.querySelectorAll("[data-del-brief]").forEach(btn=>{
    btn.addEventListener("click",async()=>await dbDelete(refs.emailBriefs().id ? refs.emailBriefs() : null));
  });
}

export async function init(container, ctx) {
  _container = container;
  _ctx = ctx;
  const { subscribe } = await import("../js/state.js");
  _stateUnsub = subscribe(() => render());
  render();
}

export function cleanup() {
  _stateUnsub?.();
  _stateUnsub = null;
  _container = null;
  _ctx = null;
}
