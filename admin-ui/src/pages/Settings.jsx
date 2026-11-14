// Settings: bot name, language, mode, product and help center, working hours, email, AI key and model, connections, backup. Plus the Change log page.
import { useEffect, useRef, useState } from "react";
import { Btn, Header, Modal, act, closeModal, confirmBox, openModal } from "../components/ui.jsx";
import { api } from "../lib/api.js";
import { fmtTime, pad, pick, tzLabel } from "../lib/format.js";
import { get, set, setS, useStore } from "../lib/store.js";
import { fail, toast } from "../lib/toast.js";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TIMES = Array.from({ length: 49 }, (_, i) => `${pad(Math.floor(i / 2))}:${i % 2 ? "30" : "00"}`);
const MODES = [
  ["off", "Off", "The bot doesn't reply to anyone. Only your team answers customers."],
  ["offline", "When team is offline", "The bot only replies when nobody on the team is online in Crisp."],
  ["always", "Always on", "The bot replies to every message, even when the team is online."],
];
const EFFORT = [["off", "Off"], ["low", "Low (recommended)"], ["medium", "Medium"], ["high", "High"]];

/** "Mon-Fri 08:00-18:00" → { days: Set of 0..6, open, close } */
export function parseBH(s) {
  const m = String(s || "").trim().match(/^([A-Za-z,\- ]+)\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const idx = (x) => DAYS.findIndex((d) => d.toLowerCase() === x.trim().slice(0, 3).toLowerCase());
  const days = new Set();
  for (const part of m[1].split(",").map((x) => x.trim()).filter(Boolean)) {
    const [a, b] = part.split("-").map(idx);
    if (a < 0 || b === -1) return null;
    if (b === undefined) days.add(a);
    else for (let d = a; ; d = (d + 1) % 7) { days.add(d); if (d === b) break; }
  }
  return { days, open: `${pad(m[2])}:${m[3]}`, close: `${pad(m[4])}:${m[5]}` };
}

export function buildBH(days, open, close) {
  const ds = [...days].sort((a, b) => a - b);
  if (!ds.length) return "";
  const parts = [];
  let start = ds[0];
  let prev = ds[0];
  for (const d of [...ds.slice(1), 99]) {
    if (d === prev + 1) { prev = d; continue; }
    parts.push(start === prev ? DAYS[start] : `${DAYS[start]}-${DAYS[prev]}`);
    start = prev = d;
  }
  return `${parts.join(",")} ${open}-${close}`;
}

/** What is saved → what the page edits until Save settings */
function draftOf(S) {
  const s = S.settings;
  const bh = parseBH(s.businessHours) || { days: new Set(), open: "08:00", close: "24:00" };
  return {
    botName: s.botName,
    language: /^auto$/i.test(s.language) ? "auto" : s.language,
    mode: s.mode,
    days: [...bh.days],
    open: pick(TIMES, bh.open),
    close: pick(TIMES, bh.close),
    utcOffset: pick(S.meta.utcOffsets, String(s.utcOffset)),
    supportEmail: s.supportEmail,
    product: s.product === "our product" ? "" : s.product,
    productDesc: s.productDesc,
    helpUrl: s.helpUrl,
    helpSections: s.helpSections,
    helpPages: s.helpPages,
    helpSelector: s.helpSelector,
    model: s.model,
    effort: pick(EFFORT.map((e) => e[0]), s.effort),
  };
}

/* ------------------------------ OpenAI key + model ------------------------------ */

async function loadModels() {
  set({ models: { loading: true } });
  try {
    set({ models: { list: (await api("/api/openai", { op: "models" })).models } });
  } catch (e) {
    set({ models: { error: `Couldn't load models: ${e.message}` } });
  }
}

async function removeKey() {
  const text = get().S.ai?.cloudflare ? "The bot goes back to the OPENAI_API_KEY set in Cloudflare." : "No other key is set, so the bot stops answering customers until you add a key.";
  if (!(await confirmBox("Remove the saved key?", text, "Remove", true))) return;
  await api("/api/openai", { op: "removeKey" });
  setS(await api("/api/state"));
  set({ models: null });
  toast("Key removed");
}

function KeyStatus({ ai }) {
  if (ai?.from === "admin") {
    const who = [ai.by && `by ${ai.by}`, ai.at && fmtTime(ai.at)].filter(Boolean).join(", ");
    return (
      <>
        ✓ Key saved here: <code>{ai.hint}</code>
        {who ? ` (${who})` : ""}.{" "}
        <button type="button" className="lk" onClick={act(removeKey)}>
          Remove
        </button>
      </>
    );
  }
  if (ai?.from === "cloudflare") {
    return (
      <>
        ✓ Using <code>OPENAI_API_KEY</code> from Cloudflare (<code>{ai.hint}</code>). A key saved here replaces it.
      </>
    );
  }
  return (
    <>
      <b style={{ color: "var(--red)" }}>No key yet.</b> The bot can't answer customers until you add one.
    </>
  );
}

/** The model field: a list once the key's models are loaded, a text box before that */
function ModelBox({ value, onChange }) {
  const { S, models: M } = useStore();
  const cur = value.trim() || S.settings.model;
  if (M?.list?.length) {
    const ids = M.list.map((m) => m.id);
    return (
      <>
        <div className="copy" style={{ maxWidth: 420 }}>
          <select className="in" id="md" value={cur} onChange={(e) => onChange(e.target.value)}>
            {ids.includes(cur) ? null : <option value={cur}>{cur} (not available for this key)</option>}
            {ids.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <Btn className="btn" onClick={loadModels}>
            Reload
          </Btn>
        </div>
        <p className="meta">{ids.length} models this key can use, newest first. The bot needs one that supports the Responses API with structured output (most GPT models do).</p>
      </>
    );
  }
  const note = M?.loading ? "Loading the models your key can use…" : M?.error ? M.error : S.ai?.from ? "" : "Add a key above to choose from the models it can use.";
  return (
    <>
      <div className="copy" style={{ maxWidth: 420 }}>
        <input className="in" id="md" value={value} onChange={(e) => onChange(e.target.value)} maxLength={60} />
        {S.ai?.from && !M?.loading ? (
          <Btn className="btn" onClick={loadModels}>
            Load models
          </Btn>
        ) : null}
      </div>
      {note ? <p className="meta">{note}</p> : null}
    </>
  );
}

/* --------------------------------- Restore --------------------------------- */

function RestoreDialog({ data }) {
  const parts = get().S.meta.restoreSections;
  const [ticked, setTicked] = useState(() => Object.keys(parts));
  const when = data.exportedAt ? fmtTime(Date.parse(data.exportedAt)) : "an unknown date";
  const go = async () => {
    if (!ticked.length) throw new Error("Tick at least one part");
    await api("/api/import", { data, sections: Object.keys(parts).filter((k) => ticked.includes(k)) });
    closeModal();
    toast("Restored. Reloading…");
    setTimeout(() => location.reload(), 900);
  };
  return (
    <Modal
      title="Restore from backup"
      footer={
        <>
          <button className="btn" value="close">
            Cancel
          </button>
          <Btn className="btn pri danger" onClick={go}>
            Restore
          </Btn>
        </>
      }
    >
      <p style={{ margin: "0 0 12px" }}>
        Backup from {when}. Choose what to restore. Each ticked part <b>replaces</b> what this bot has now; unticked parts stay as they are.
      </p>
      <div className="checks" id="impParts" style={{ gridTemplateColumns: "1fr" }}>
        {Object.entries(parts).map(([k, label]) => (
          <label className="chk" key={k}>
            <input type="checkbox" value={k} checked={ticked.includes(k)} onChange={(e) => setTicked(e.target.checked ? [...ticked, k] : ticked.filter((x) => x !== k))} /> {label}
          </label>
        ))}
      </div>
      <p className="note">Setting up a bot for another product? Untick "Product and knowledge sources" and "Snippets" to bring over only how the bot behaves. Download a backup of the current setup first.</p>
    </Modal>
  );
}

async function restoreFrom(file) {
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toast("Couldn't read that file. Choose a .json file from the Download backup button.", { err: true });
    return;
  }
  openModal(<RestoreDialog data={data} />);
}

/* ---------------------------------- Page ---------------------------------- */

export default function Settings() {
  const { S, models } = useStore();
  const s = S.settings;
  const [d, setD] = useState(() => draftOf(S));
  const [key, setKey] = useState("");
  const hook = useRef(null);
  const file = useRef(null);
  const up = (k) => (e) => setD((cur) => ({ ...cur, [k]: e.target.value }));

  // Bot mode switched in the box on the left: show it here too
  useEffect(() => setD((cur) => ({ ...cur, mode: s.mode })), [s.mode]);
  // A key is set but its models aren't listed yet
  useEffect(() => {
    if (S.ai?.from && !models) loadModels();
  }, [S.ai?.from, !models]);

  const bh = buildBH(new Set(d.days), d.open, d.close);
  const src = (k) => (S.sources[k] === "cloudflare" ? <small>Currently read from a Cloudflare variable; saving here uses the new value instead.</small> : null);
  const timeSel = (id, k) => (
    <select className="in" id={id} style={{ width: "auto" }} value={d[k]} onChange={up(k)}>
      {TIMES.map((t) => (
        <option key={t}>{t}</option>
      ))}
    </select>
  );
  const toggleDay = (i) => setD((cur) => ({ ...cur, days: cur.days.includes(i) ? cur.days.filter((x) => x !== i) : [...cur.days, i] }));

  const saveKey = async () => {
    const k = key.trim();
    if (!k) throw new Error("Paste the key first");
    const r = await api("/api/openai", { op: "saveKey", key: k });
    setS(await api("/api/state"));
    set({ models: r.models ? { list: r.models } : { error: r.warning } });
    setKey("");
    toast(r.warning || "Key saved and checked with OpenAI");
  };
  const save = async () => {
    if (bh && d.open >= d.close) throw new Error("The end time must be after the start time");
    const settings = {
      botName: d.botName,
      language: d.language,
      mode: d.mode,
      businessHours: bh,
      utcOffset: d.utcOffset,
      supportEmail: d.supportEmail.trim(),
      product: d.product.trim(),
      productDesc: d.productDesc.trim(),
      helpUrl: d.helpUrl.trim().replace(/\/+$/, ""),
      helpSections: d.helpSections.trim(),
      helpPages: d.helpPages.split("\n").map((l) => l.trim()).filter(Boolean).join("\n"),
      helpSelector: d.helpSelector.trim(),
      model: d.model.trim() || (models?.list?.length ? s.model : ""),
      effort: d.effort,
    };
    const r = await api("/api/settings", { settings });
    setS(r);
    setD(draftOf({ ...S, ...r }));
    toast(r.helpSync ? "Settings saved. The help center is syncing again: see progress on the Knowledge page." : "Settings saved");
  };
  const copyHook = async () => {
    try {
      await navigator.clipboard.writeText(S.webhookUrl);
      toast("Webhook link copied");
    } catch {
      hook.current.select();
      toast("Press Ctrl+C (or Cmd+C) to copy");
    }
  };
  const customLanguage = !["English", "auto"].includes(d.language);

  return (
    <>
      <Header title="Settings" desc="Changes reach real customers within about a minute." />
      <section className="sec">
        <h2>Bot</h2>
        <div className="form">
          <div className="fr">
            <label htmlFor="bn">
              Bot name<small>Customers see this name in the chat</small>
              {src("botName")}
            </label>
            <input className="in" id="bn" value={d.botName} onChange={up("botName")} maxLength={40} />
          </div>
          <div className="fr">
            <label htmlFor="lg">
              Reply language{src("language")}
            </label>
            <select className="in" id="lg" value={d.language} onChange={up("language")}>
              <option value="English">Always reply in English</option>
              <option value="auto">Match the customer's language</option>
              {customLanguage ? <option value={d.language}>{d.language}</option> : null}
            </select>
          </div>
          <div className="fr">
            <div className="lb">Mode</div>
            <div className="radios">
              {MODES.map(([v, t, text]) => (
                <label className="radio" key={v}>
                  <input type="radio" name="mode" value={v} checked={d.mode === v} onChange={() => setD({ ...d, mode: v })} />
                  <div>
                    <b>{t}</b>
                    <span>{text}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>
      <section className="sec">
        <h2>Product</h2>
        <div className="form">
          <div className="fr">
            <label htmlFor="pn">
              Product name<small>The app or service the bot supports</small>
              {src("product")}
            </label>
            <input className="in" id="pn" value={d.product} onChange={up("product")} maxLength={60} placeholder="My App" />
          </div>
          <div className="fr">
            <label htmlFor="pd">
              About the product<small>What it does and who the customers are, plus anything the bot must always know. The bot reads this before every reply.</small>
              {src("productDesc")}
            </label>
            <textarea className="in" id="pd" rows={4} maxLength={1000} value={d.productDesc} onChange={up("productDesc")} placeholder="My App helps … Customers are …" />
          </div>
          <div className="fr">
            <label htmlFor="hu">
              Help center link<small>The bot reads every article listed in the site's sitemap (found automatically). Leave empty if you don't have a help center yet.</small>
              {src("helpUrl")}
            </label>
            <input className="in" id="hu" type="url" value={d.helpUrl} onChange={up("helpUrl")} maxLength={200} placeholder="https://help.example.com" />
          </div>
          <div className="fr">
            <label htmlFor="hs">
              Help center sections<small>Only read articles under these paths, separated by commas (for example docs,faq). Leave empty to read the whole site.</small>
              {src("helpSections")}
            </label>
            <input className="in" id="hs" value={d.helpSections} onChange={up("helpSections")} maxLength={200} placeholder="docs,faq" />
          </div>
          <div className="fr">
            <label htmlFor="hp">
              Help center pages<small>Optional. One article link per line. Use it when the help center has no sitemap, or to add articles the sitemap misses.</small>
              {src("helpPages")}
            </label>
            <textarea className="in" id="hp" rows={3} maxLength={40000} spellCheck={false} value={d.helpPages} onChange={up("helpPages")} placeholder="https://help.example.com/articles/getting-started" />
          </div>
          <div className="fr">
            <label htmlFor="hc">
              Article content area<small>Advanced, optional. The bot finds the article text by itself on most help centers. If it picks up menus or misses text, enter the CSS selector of the article body, for example .article-body.</small>
              {src("helpSelector")}
            </label>
            <input className="in" id="hc" value={d.helpSelector} onChange={up("helpSelector")} maxLength={120} spellCheck={false} placeholder=".article-body" />
          </div>
        </div>
      </section>
      <section className="sec">
        <h2>Support team</h2>
        <div className="form">
          <div className="fr">
            <label htmlFor="tz">
              Time zone<small>Your team's time zone. Working hours, reports and "the team is back at…" use it.</small>
              {src("utcOffset")}
            </label>
            <select className="in" id="tz" style={{ width: "auto" }} value={d.utcOffset} onChange={up("utcOffset")}>
              {S.meta.utcOffsets.map((o) => (
                <option key={o} value={o}>
                  {tzLabel(o)}
                </option>
              ))}
            </select>
          </div>
          <div className="fr">
            <div className="lb">
              Working hours<small>In your team's time zone. Outside these hours the bot tells customers when the team is back.</small>
              {src("businessHours")}
            </div>
            <div>
              <div className="days" role="group" aria-label="Working days">
                {DAYS.map((day, i) => (
                  <label key={day}>
                    <input type="checkbox" value={i} checked={d.days.includes(i)} onChange={() => toggleDay(i)} />
                    <span>{day}</span>
                  </label>
                ))}
              </div>
              <div className="times">
                From {timeSel("bo", "open")} to {timeSel("bc", "close")}
              </div>
              <p className="meta" id="bhx">
                {bh ? `Saved as: ${bh}` : "No days selected: the bot won't tell customers your working hours."}
              </p>
            </div>
          </div>
          <div className="fr">
            <label htmlFor="em">
              Support email<small>The bot suggests this email when it hands off</small>
              {src("supportEmail")}
            </label>
            <input className="in" id="em" type="email" value={d.supportEmail} onChange={up("supportEmail")} maxLength={120} placeholder="support@…" />
          </div>
        </div>
      </section>
      <section className="sec">
        <h2>AI</h2>
        <div className="form">
          <div className="fr">
            <label htmlFor="ak">
              OpenAI API key
              <small>
                Create one at{" "}
                <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">
                  platform.openai.com/api-keys
                </a>
                . It's checked with OpenAI before saving and is never shown again in full.
              </small>
            </label>
            <div>
              <p className="meta" style={{ margin: "0 0 8px" }}>
                <KeyStatus ai={S.ai} />
              </p>
              <div className="copy">
                <input className="in" id="ak" type="password" autoComplete="off" spellCheck={false} maxLength={300} value={key} onChange={(e) => setKey(e.target.value)} placeholder={S.ai?.from ? "Paste a new key to replace it" : "sk-…"} />
                <Btn className="btn" onClick={saveKey}>
                  Save key
                </Btn>
              </div>
            </div>
          </div>
          <div className="fr">
            <label htmlFor="md">
              OpenAI model<small>Only models your key can use are listed. Click Save settings to switch.</small>
              {src("model")}
            </label>
            <div id="mdBox">
              <ModelBox value={d.model} onChange={(v) => setD({ ...d, model: v })} />
            </div>
          </div>
          <div className="fr">
            <label htmlFor="ef">Reasoning effort</label>
            <select className="in" id="ef" style={{ width: "auto" }} value={d.effort} onChange={up("effort")}>
              {EFFORT.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>
      <div className="savebar">
        <p className="meta">You can also switch the bot mode quickly in the box on the left.</p>
        <Btn className="btn pri" onClick={save}>
          Save settings
        </Btn>
      </div>

      <section className="sec">
        <h2>Crisp connection</h2>
        <div className="form">
          <div className="fr">
            <label htmlFor="wh">
              Webhook link<small>Paste into Crisp Marketplace → your plugin → Settings → Events</small>
            </label>
            <div className="copy">
              <input className="in" id="wh" value={S.webhookUrl} readOnly ref={hook} />
              <button type="button" className="btn" onClick={copyHook}>
                Copy
              </button>
            </div>
          </div>
          <div className="fr">
            <div className="lb">
              Secret keys<small>Crisp keys: Cloudflare → this Worker → Settings → Variables and secrets. OpenAI key: the AI section above.</small>
            </div>
            <div className="rows">
              {S.health.map((h) => (
                <div className="row" key={h.label}>
                  <span className={`st ${h.ok ? "ok" : "bad"}`} aria-hidden="true">
                    {h.ok ? "✓" : "!"}
                  </span>
                  <div className="grow">
                    <p className="t">{h.label}</p>
                    <p className="sub">{h.ok ? h.detail || "Set" : h.fix}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
      <section className="sec">
        <h2>Backup</h2>
        <div className="form">
          <div className="fr">
            <div className="lb">
              All bot settings<small>Snippets, guidance, writing style, escalation, tags, settings and the list of articles that are off. When restoring you choose which parts to bring back, so one bot's setup can start another product's bot.</small>
            </div>
            <div className="toolbar" style={{ margin: 0 }}>
              <a className="btn" href="/api/export" download>
                Download backup
              </a>
              <button type="button" className="btn" onClick={() => file.current.click()}>
                Restore from file
              </button>
              <input
                type="file"
                id="impf"
                accept="application/json,.json"
                hidden
                ref={file}
                onChange={(e) => {
                  const f = e.target.files[0];
                  e.target.value = ""; // the same file can be chosen again
                  restoreFrom(f);
                }}
              />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/* -------------------------------- Change log -------------------------------- */

export function Changelog() {
  const { S } = useStore();
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    api("/api/state")
      .then((r) => {
        if (!live) return;
        setS({ changelog: r.changelog });
        setLoaded(true);
      })
      .catch(fail);
    return () => {
      live = false;
    };
  }, []);
  if (!loaded) {
    return (
      <>
        <Header title="Change log" />
        <p className="loading">Loading…</p>
      </>
    );
  }
  return (
    <>
      <Header title="Change log" desc="Who changed what in the admin, newest first. Names come from the Your name field at sign-in." />
      <section className="sec">
        {S.changelog.length ? (
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 120 }}>Time</th>
                <th style={{ width: 140 }}>Changed by</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {S.changelog.map((c, i) => (
                <tr key={i}>
                  <td className="num" style={{ textAlign: "left" }}>
                    {fmtTime(c.t)}
                  </td>
                  <td>{c.who}</td>
                  <td>{c.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="rows">
            <div className="empty">No changes yet.</div>
          </div>
        )}
      </section>
    </>
  );
}
