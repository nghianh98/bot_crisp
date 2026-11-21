// Writing style: a tool only. The team writes the rules, the introduction and the example replies; nothing about tone is fixed in code.
import { Fragment, useEffect, useState } from "react";
import { act, AutoText, Btn, closeModal, confirmBox, Header, Modal, openModal, Switch } from "../components/ui.jsx";
import { api } from "../lib/api.js";
import { ago, matches, n, plural } from "../lib/format.js";
import { colName, guessColumns, parseDelimited, readSheetFile, toItems } from "../lib/sheet.js";
import { get, setS, setUI, useStore } from "../lib/store.js";
import { toast } from "../lib/toast.js";

async function saveSettings(body, msg) {
  const r = await api("/api/style", { op: "settings", ...body });
  setS({ style: r.style });
  toast(`${msg}. Try it in the Test panel.`);
  return r.style;
}

/* ------------------------------ One example ------------------------------ */

function ExampleDialog({ id }) {
  const { S } = useStore();
  const [e, setE] = useState(() => {
    const x = S.style.examples.find((it) => it.id === id) || { group: "", situation: "", text: "", enabled: true };
    return { group: x.group || "", situation: x.situation || "", text: x.text || "", enabled: !!x.enabled };
  });
  const groups = [...new Set(S.style.examples.map((x) => x.group).filter(Boolean))];
  const up = (k) => (ev) => setE({ ...e, [k]: ev.target.type === "checkbox" ? ev.target.checked : ev.target.value });
  const save = async () => {
    const r = await api("/api/style", { op: "save", item: { id: id || undefined, group: e.group, situation: e.situation, text: e.text, enabled: e.enabled } });
    setS({ style: r.style });
    closeModal();
    toast("Example reply saved. Try it in the Test panel.");
  };
  return (
    <Modal
      title={id ? "Edit example reply" : "New example reply"}
      footer={
        <>
          <button className="btn" value="close">
            Cancel
          </button>
          <Btn className="btn pri" onClick={save}>
            Save reply
          </Btn>
        </>
      }
    >
      <label className="fl" htmlFor="exg">
        Group <span className="muted">(optional, for example Pricing)</span>
      </label>
      <input className="in" id="exg" list="exgl" value={e.group} onChange={up("group")} maxLength={60} />
      <datalist id="exgl">
        {groups.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
      <label className="fl" htmlFor="exs">
        Situation <span className="muted">(when this reply fits; helps the bot pick it)</span>
      </label>
      <input className="in" id="exs" value={e.situation} onChange={up("situation")} maxLength={160} placeholder="For example: Customer asks if they can use the free plan" />
      <label className="fl" htmlFor="ext">
        The reply your team sent
      </label>
      <textarea className="in" id="ext" rows={10} maxLength={3000} value={e.text} onChange={up("text")} placeholder="Paste the whole reply, as the customer saw it." />
      <label className="chk">
        <input type="checkbox" id="exe" checked={e.enabled} onChange={up("enabled")} /> The bot learns from this reply
      </label>
    </Modal>
  );
}

const openExample = (id) => openModal(<ExampleDialog id={id || null} />, { wide: true, focus: id ? "#ext" : "#exs" });

/* --------------------------------- Import --------------------------------- */

// Sheets read from the file, the chosen sheet, the column choices and the rows (with their tick state)
function ImportDialog() {
  const [imp, setImp] = useState({ sheets: [], si: 0, cols: null, items: [] });
  const [pasted, setPasted] = useState("");

  const pickSheet = (sheets, si) => {
    const cols = guessColumns(sheets[si].rows);
    setImp({ sheets, si, cols, items: toItems(sheets[si].rows, cols) });
  };
  const loadSheets = (all) => {
    const sheets = all.filter((s) => s.rows.length);
    if (!sheets.length) return toast("That file has no rows", { err: true });
    // Start on the sheet that looks most like saved replies: the most rows with real text in the reply column
    const score = (s) => toItems(s.rows, guessColumns(s.rows)).filter((x) => x.on).length;
    pickSheet(sheets, sheets.reduce((best, s, i) => (score(s) > score(sheets[best]) ? i : best), 0));
  };
  const readFile = async (ev) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    try {
      loadSheets(await readSheetFile(f));
    } catch (e) {
      toast(e?.message || "Couldn't read that file", { err: true });
    }
  };
  const readPasted = () => {
    const rows = parseDelimited(pasted);
    if (!rows.length) return toast("Paste some cells first", { err: true });
    loadSheets([{ name: "Pasted cells", rows }]);
  };
  const remap = (k) => (ev) => {
    const cols = { ...imp.cols, [k]: +ev.target.value };
    setImp({ ...imp, cols, items: toItems(imp.sheets[imp.si].rows, cols) });
  };
  const tick = (k, on) => setImp({ ...imp, items: imp.items.map((x, i) => (i === k ? { ...x, on } : x)) });
  const tickAll = (on) => setImp({ ...imp, items: imp.items.map((x) => ({ ...x, on })) });
  const go = async () => {
    const before = get().S.style.examples.length;
    const items = imp.items.filter((x) => x.on).map(({ group, situation, text }) => ({ group, situation, text }));
    const r = await api("/api/style", { op: "import", items });
    setS({ style: r.style });
    closeModal();
    toast(`Imported ${plural(r.style.examples.length - before, "example reply", "example replies")}. Try a few questions in the Test panel.`);
  };

  const sh = imp.sheets[imp.si];
  const picked = imp.items.filter((x) => x.on).length;
  const width = sh ? Math.max(1, ...sh.rows.map((r) => r.length)) : 0;
  const head = sh && imp.cols.header >= 0 ? sh.rows[imp.cols.header] : [];
  const colSelect = (id, k, none) => (
    <select className="in" id={id} value={imp.cols[k]} onChange={remap(k)}>
      {none ? <option value={-1}>(none)</option> : null}
      {Array.from({ length: width }, (_, c) => (
        <option key={c} value={c}>
          Column {colName(c)}
          {head[c] ? `: ${String(head[c]).slice(0, 30)}` : ""}
        </option>
      ))}
    </select>
  );

  return (
    <Modal
      title="Import example replies"
      footer={
        <>
          <button className="btn" value="close">
            Cancel
          </button>
          <Btn className="btn pri" id="exgo" disabled={!picked} onClick={go}>
            {picked ? `Import ${plural(picked, "reply", "replies")}` : "Import"}
          </Btn>
        </>
      }
    >
      <p className="hint" style={{ margin: "0 0 12px" }}>
        Choose an Excel (.xlsx) or CSV file with your team's saved replies: one reply per row, ideally with columns like <b>Group</b>, <b>Situation</b> and <b>Reply</b> (Nhóm, Tình huống, Nội dung also work). You pick the rows before anything is saved.
      </p>
      <input type="file" id="exf" accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={readFile} />
      <details style={{ marginTop: 12 }}>
        <summary>Or paste cells copied from Excel or Google Sheets</summary>
        <textarea className="in" id="expaste" rows={5} style={{ marginTop: 8 }} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Select the cells (with the header row), copy, paste here" />
        <div className="toolbar" style={{ marginTop: 8 }}>
          <button type="button" className="btn sm" onClick={readPasted}>
            Read pasted cells
          </button>
        </div>
      </details>
      <div id="exprev">
        {sh ? (
          <>
            <div className="form" style={{ marginTop: 16 }}>
              {imp.sheets.length > 1 ? (
                <div className="fr">
                  <label htmlFor="exsh">Sheet</label>
                  <select className="in" id="exsh" value={imp.si} onChange={(e) => pickSheet(imp.sheets, +e.target.value)}>
                    {imp.sheets.map((s, k) => (
                      <option key={k} value={k}>
                        {s.name} ({plural(s.rows.length, "row")})
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="fr">
                <label htmlFor="exct">Reply column</label>
                {colSelect("exct", "text", false)}
              </div>
              <div className="fr">
                <label htmlFor="excs">Situation column</label>
                {colSelect("excs", "situation", true)}
              </div>
              <div className="fr">
                <label htmlFor="excg">Group column</label>
                {colSelect("excg", "group", true)}
              </div>
            </div>
            <div className="sec-h" style={{ margin: "16px 0 8px" }}>
              <p className="meta" style={{ margin: 0 }}>
                <b>{n(picked)}</b> of {plural(imp.items.length, "row")} ticked. Untick notes, links and replies for other apps.
              </p>
              <div className="toolbar" style={{ margin: 0 }}>
                <button type="button" className="btn ghost sm" onClick={() => tickAll(true)}>
                  Tick all
                </button>
                <button type="button" className="btn ghost sm" onClick={() => tickAll(false)}>
                  Untick all
                </button>
              </div>
            </div>
            <div className="rows" style={{ maxHeight: "46vh", overflow: "auto" }}>
              {imp.items.length ? (
                imp.items.map((x, k) => (
                  <label className="row" style={{ cursor: "pointer" }} key={x.i}>
                    <input type="checkbox" checked={x.on} onChange={(e) => tick(k, e.target.checked)} style={{ marginTop: 4, accentColor: "var(--blue)" }} />
                    <div className="grow">
                      <p className="t">
                        {x.situation || x.text.split("\n")[0].slice(0, 90)}
                        {x.group ? (
                          <>
                            {" "}
                            <span className="chip">{x.group}</span>
                          </>
                        ) : null}
                      </p>
                      <p className="sub clamp">{x.text}</p>
                    </div>
                  </label>
                ))
              ) : (
                <div className="empty">No replies in this column. Choose another column or sheet.</div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

/* ---------------------------------- Page ---------------------------------- */

export default function Style() {
  const { S, ui } = useStore();
  const st = S.style;
  const M = S.meta;
  const q = ui.exq;
  const isDefault = st.rules == null;
  const [rules, setRules] = useState(isDefault ? M.defaultRules : st.rules);
  const [intro, setIntro] = useState(st.intro);
  // Saved (or restored) elsewhere: show what is saved now
  useEffect(() => setRules(st.rules == null ? M.defaultRules : st.rules), [st.rules]);
  useEffect(() => setIntro(st.intro), [st.intro]);

  const on = st.examples.filter((e) => e.enabled).length;
  const list = st.examples.filter((e) => matches(q, e.group, e.situation, e.text));
  const groups = [...new Set(list.map((e) => e.group || ""))];

  const resetRules = async () => {
    if (!(await confirmBox("Restore the default rules?", "Your writing rules will be replaced with the default ones the bot used before this page existed.", "Restore", false))) return;
    await saveSettings({ rules: null }, "Default writing rules restored");
  };
  const toggle = async (e) => {
    const r = await api("/api/style", { op: "save", item: { ...e, enabled: !e.enabled } });
    setS({ style: r.style });
    toast(e.enabled ? "The bot no longer learns from this reply" : "The bot learns from this reply again");
  };
  const del = async (e) => {
    if (!(await confirmBox("Delete example reply?", `"${(e.situation || e.text).slice(0, 70)}" will be deleted.`))) return;
    const r = await api("/api/style", { op: "delete", id: e.id });
    setS({ style: r.style });
    toast("Example reply deleted");
  };
  const delAll = async () => {
    const ids = st.examples.map((e) => e.id);
    if (!(await confirmBox("Delete all example replies?", `All ${ids.length} example replies will be deleted. Download a backup in Settings first if you may need them again.`, "Delete all"))) return;
    const r = await api("/api/style", { op: "delete", ids });
    setS({ style: r.style });
    setUI({ exq: "" });
    toast("All example replies deleted");
  };
  const openImport = () => openModal(<ImportDialog />, { wide: true });
  const row = (e) => (
    <div className="row" key={e.id}>
      <Switch on={e.enabled} label="The bot learns from this reply" onClick={() => toggle(e)} />
      <div className="grow">
        <button type="button" className="lk t" onClick={() => openExample(e.id)}>
          {e.situation || e.text.split("\n")[0].slice(0, 90)}
        </button>
        <p className="sub clamp">{e.text}</p>
        <p className="meta">
          Edited {ago(e.upd)}
          {e.by ? ` by ${e.by}` : ""}
        </p>
      </div>
      <div className="acts">
        <button type="button" className="btn ghost sm danger" onClick={act(() => del(e))}>
          Delete
        </button>
      </div>
    </div>
  );

  return (
    <>
      <Header title="Writing style" desc="How the bot writes, in your own words: the rules for every reply, how it introduces itself, and real replies from your team." />
      <section className="sec">
        <div className="sec-h">
          <h2>Writing rules</h2>
          {isDefault ? <span className="chip">Default rules</span> : null}
        </div>
        <p className="hint">
          Write how every reply should look, one rule per line: length, how to open and close, whether to sign off with a name, how to show steps and links. You can add an example reply at the end. Snippets that are sent exactly as written (see Knowledge) don't follow these rules. The chat can't show bold or bullet symbols, so the bot always writes plain text.
        </p>
        <AutoText id="stRules" minRows={8} maxHeight={760} maxLength={M.maxRulesChars} spellCheck={false} value={rules} onChange={(e) => setRules(e.target.value)} placeholder="Leave empty to give the bot no writing rules" />
        <div className="toolbar">
          <Btn className="btn pri" onClick={() => saveSettings({ rules }, rules.trim() ? "Writing rules saved" : "Writing rules removed")}>
            Save rules
          </Btn>
          {isDefault ? null : (
            <button type="button" className="btn ghost" onClick={act(resetRules)}>
              Restore default rules
            </button>
          )}
          <span className="meta" id="stRulesN" style={{ margin: 0 }}>
            {n(rules.length)} / {n(M.maxRulesChars)} characters
          </span>
        </div>
      </section>
      <section className="sec">
        <h2>How the bot introduces itself</h2>
        <p className="hint">Used once, in the bot's first reply of a conversation. If a customer asks whether they're talking to a bot, it still says it's an AI assistant. Leave empty to skip the introduction.</p>
        <div className="form">
          <div className="fr">
            <label htmlFor="stIntro">Introduce as</label>
            <div>
              <div className="toolbar" style={{ margin: 0 }}>
                <AutoText
                  oneLine
                  id="stIntro"
                  maxLength={80}
                  value={intro}
                  onChange={(e) => setIntro(e.target.value.replace(/\s*\n\s*/g, " "))}
                  placeholder={`For example: Alex from the ${S.settings.product && S.settings.product !== "our product" ? S.settings.product : "Acme"} Support Team`}
                  style={{ flex: 1, minWidth: 220 }}
                />
                <Btn className="btn" onClick={() => saveSettings({ intro }, intro.trim() ? "Introduction saved" : "Introduction removed")}>
                  Save
                </Btn>
              </div>
              <p className="meta">The bot writes it as: "Hi there, I'm {st.intro || "…"}."</p>
            </div>
          </div>
        </div>
      </section>
      <section className="sec">
        <div className="sec-h">
          <h2>Example replies from your team</h2>
          <div className="toolbar" style={{ margin: 0 }}>
            <button type="button" className="btn sm" onClick={openImport}>
              Import from Excel or CSV
            </button>
            <button type="button" className="btn sm pri" onClick={() => openExample(null)}>
              Add
            </button>
          </div>
        </div>
        <p className="hint">
          Paste replies your team actually sent. For each customer message the bot picks the {n(6)} closest ones and writes in the same voice, following your writing rules above. They teach the <b>voice only</b>: facts, prices, links and promises still come from snippets and the help center, never from these. {plural(on, "reply", "replies")} in use, up to {n(M.maxExamples)}.
        </p>
        {st.examples.length ? (
          <div className="toolbar" style={{ margin: "0 0 12px" }}>
            <input className="in search" type="search" id="exq" placeholder="Search" value={q} onChange={(e) => setUI({ exq: e.target.value })} aria-label="Search example replies" />
            <button type="button" className="btn ghost sm danger" onClick={act(delAll)}>
              Delete all
            </button>
          </div>
        ) : null}
        {st.examples.length ? (
          list.length ? (
            groups.map((g) => (
              <Fragment key={g}>
                {g ? (
                  <p className="meta" style={{ margin: "16px 0 6px", fontWeight: 600 }}>
                    {g}
                  </p>
                ) : null}
                <div className="rows">{list.filter((e) => (e.group || "") === g).map(row)}</div>
              </Fragment>
            ))
          ) : (
            <div className="rows">
              <div className="empty">Nothing matches "{q}".</div>
            </div>
          )
        ) : (
          <div className="rows">
            <div className="empty">
              No example replies yet.{" "}
              <button type="button" className="lk" onClick={openImport}>
                Import your team's saved replies
              </button>{" "}
              (a sheet with columns like Group, Situation, Reply), or{" "}
              <button type="button" className="lk" onClick={() => openExample(null)}>
                add one
              </button>
              .
            </div>
          </div>
        )}
      </section>
    </>
  );
}
