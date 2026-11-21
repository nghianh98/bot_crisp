// Knowledge: snippets written by the team, help center articles, website pages. The bot only answers from sources that are on.
import { Fragment, useState } from "react";
import { openSnippet } from "../components/Snippet.jsx";
import { Btn, Header, Modal, Switch, act, closeModal, confirmBox, openModal } from "../components/ui.jsx";
import { api } from "../lib/api.js";
import { ago, host, matches, n, plural } from "../lib/format.js";
import { pvAsk } from "../lib/preview.js";
import { get, set, setS, setUI, useStore } from "../lib/store.js";
import { fail, toast } from "../lib/toast.js";

const SECTIONS = { docs: "Guides", faq: "FAQ", troubleshooting: "Troubleshooting", comparisons: "Comparisons" };
const SRC = { manual: "Written by hand", gap: "From Suggestions", import: "Bulk import", legacy: "From the old FAQ" };
const AUTO = [["weekly", "Every week"], ["daily", "Every day"], ["off", "Off, sync by hand"]];
const EVERY = { weekly: "synced every week", daily: "synced every day", off: "synced by hand" };

function inDays(t) {
  const d = Math.round((t - Date.now()) / 86400000);
  return d <= 0 ? "in the next few minutes" : d === 1 ? "tomorrow" : `in ${d} days`;
}

/* ---------------------------------- Sync ---------------------------------- */

// Sync all sources: start, then keep stepping while this tab is open. Each step reads a few pages.
async function syncAll() {
  if (get().syncing) return;
  set({ syncing: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let misses = 0;
  let op = "syncStart";
  try {
    while (true) {
      try {
        const r = await api("/api/kb", { op });
        setS({ kb: r.kb });
        misses = 0;
      } catch (e) {
        if (op === "syncStart" || ++misses > 4) throw e;
        await wait(1500 * misses); // a busy moment on Cloudflare: wait a little longer each time
        continue;
      }
      op = "syncStep";
      if (!get().S.kb.sync?.running) break;
    }
    const l = get().S.kb.sync?.last;
    toast(l ? `Synced ${plural(l.pages, "page")}: ${n(l.updated ?? 0)} updated${l.failedCount ? `, ${n(l.failedCount)} couldn't be read` : ""}` : "Sync finished");
  } catch (e) {
    toast(`Sync paused (${e.message}). It finishes in the background within a few minutes, or click Continue sync.`, { err: true });
  } finally {
    set({ syncing: false });
  }
}

// An image changed but kept the same link: have the AI read every help center image again on the next sync
async function rereadImages() {
  if (get().syncing) return;
  if (!(await confirmBox("Read all images again?", "During the next sync the AI reads every image in the help center again. Use this when an image changed but kept the same link. Each image costs a little AI usage.", "Read again", false))) return;
  setS({ kb: (await api("/api/kb", { op: "rereadImages" })).kb });
  return syncAll();
}

/** Under the sources table: what the last sync did and when the next one runs */
function SyncNote() {
  const { S, syncing } = useStore();
  const k = S.kb;
  const y = k.sync || {};
  const r = y.running;
  if (r) {
    const w = Math.round((r.done / Math.max(1, r.total)) * 100);
    return (
      <div className="syncprog">
        <p className="meta">
          Syncing {n(r.done)} of {plural(r.total, "page")}…{syncing ? "" : " It finishes in the background within a few minutes."}
        </p>
        <div className="track" role="progressbar" aria-valuemin={0} aria-valuemax={r.total} aria-valuenow={r.done} aria-label="Sync progress">
          <div className="fill" style={{ width: `${w}%` }} />
        </div>
      </div>
    );
  }
  const parts = [];
  const l = y.last;
  if (l) {
    parts.push(
      <>
        Last synced {ago(l.at)}
        {l.by ? ` by ${l.by}` : ""}
        {l.updated != null ? `: ${plural(l.pages, "page")}, ${n(l.updated)} updated` : ""}
        {l.failedCount ? (
          <>
            ,{" "}
            <span className="warn" title={(l.failed || []).join("\n")}>
              {plural(l.failedCount, "page")} couldn't be read
            </span>
          </>
        ) : null}
        .
      </>
    );
  } else parts.push("Not synced yet.");
  if (y.error) parts.push(`The last automatic sync couldn't start (${y.error.msg}); it tries again every hour.`);
  else if (k.autoSync !== "off" && y.next) parts.push(`Next automatic sync ${inDays(y.next)}.`);
  else if (k.autoSync === "off") parts.push("Automatic sync is off.");
  if (k.articles.some((a) => a.src === "help")) {
    parts.push(
      <button type="button" className="lk" onClick={act(rereadImages)}>
        Read images again
      </button>
    );
  }
  // Everything that is on goes to the AI with each reply: warn when that gets very large
  const size = k.articles.filter((a) => !a.off).reduce((t, a) => t + (a.chars || 0), 0);
  return (
    <>
      <p className="note" style={{ marginTop: 8 }}>
        {parts.map((p, i) => (
          <Fragment key={i}>
            {i ? " " : ""}
            {p}
          </Fragment>
        ))}
      </p>
      {size > 600000 ? (
        <p className="note warn" style={{ marginTop: 6 }}>
          The knowledge that is on is very large (about {n(Math.round(size / 6))} words). All of it is sent to the AI with every reply, so replies get slower and cost more. Turn off articles the bot doesn't need, or narrow Help center sections in Settings.
        </p>
      ) : null}
    </>
  );
}

/* --------------------------------- Dialogs --------------------------------- */

function ImportDialog() {
  const [text, setText] = useState("");
  const go = async () => {
    const before = get().S.snippets.length;
    const r = await api("/api/snippets", { op: "import", text });
    setS({ snippets: r.snippets });
    setUI({ tab: "snippets" });
    closeModal();
    toast(`Imported ${r.snippets.length - before} snippets`);
  };
  return (
    <Modal
      title="Bulk import"
      footer={
        <>
          <button className="btn" value="close">
            Cancel
          </button>
          <Btn className="btn pri" onClick={go}>
            Import
          </Btn>
        </>
      }
    >
      <p className="hint">Write each pair as a Q: line (question) and an A: line (answer), with a blank line between pairs. H: and Đ: also work.</p>
      <textarea
        className="in"
        id="imp"
        rows={12}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Q: Do you offer free setup?\nA: Yes. Send us your account email and the team sets it up within 24 working hours.\n\nQ: Can I change my plan later?\nA: …"}
      />
    </Modal>
  );
}

function WebAddDialog() {
  const [url, setUrl] = useState("");
  const go = async () => {
    const r = await api("/api/kb", { op: "addWeb", url });
    setS({ kb: r.kb });
    setUI({ tab: "web" });
    closeModal();
    toast("Page added. Click View text to check what the bot can read.");
  };
  return (
    <Modal
      title="Add website page"
      footer={
        <>
          <button className="btn" value="close">
            Cancel
          </button>
          <Btn className="btn pri" busyText="Reading the page…" onClick={go}>
            Add page
          </Btn>
        </>
      }
    >
      <p className="hint">The bot reads the text on this page and syncs it together with the help center. Good for pricing or feature pages, up to 20 pages.</p>
      <label className="fl" htmlFor="wu">
        Page link
      </label>
      <input className="in" id="wu" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/pricing" />
    </Modal>
  );
}

async function viewArticle(a) {
  const r = await api("/api/kb", { op: "view", id: a.id });
  openModal(
    <Modal
      title={a.title}
      footer={
        <>
          <a className="btn" href={a.url} target="_blank" rel="noopener">
            Open page
          </a>
          <button className="btn pri" value="close">
            Close
          </button>
        </>
      }
    >
      <p className="hint">This is the text the bot reads from this page. Anything missing here, the bot doesn't know either.</p>
      <pre className="page">{r.text || "(empty)"}</pre>
    </Modal>,
    { wide: true }
  );
}

/* ---------------------------------- Lists ---------------------------------- */

async function kbOp(body, done) {
  const r = await api("/api/kb", body);
  setS({ kb: r.kb });
  if (done) toast(done);
}

// How the bot uses snippets: as knowledge (it writes its own reply) or sent word for word
function SnippetMode() {
  const { S } = useStore();
  const [picked, setPicked] = useState(null); // the choice being saved
  const mode = picked ?? S.settings.snippetMode;
  const choose = async (v) => {
    setPicked(v);
    try {
      setS(await api("/api/settings", { settings: { snippetMode: v } }));
      toast(v === "exact" ? "Snippets are sent exactly as written" : "Snippets are used as knowledge. Try a few questions in the Test panel.");
    } catch (e) {
      fail(e);
    }
    setPicked(null);
  };
  const opt = (v, title, desc) => (
    <label className="radio">
      <input type="radio" name="snipMode" value={v} checked={mode === v} onChange={() => choose(v)} />
      <div>
        <b>{title}</b>
        <span>{desc}</span>
      </div>
    </label>
  );
  return (
    <div className="snipmode">
      <p className="t">How the bot uses snippets</p>
      <div className="radios">
        {opt("knowledge", "As knowledge", "The bot writes its own reply from the snippets and the help center, for the exact question asked, following your writing style. You can still mark single snippets to be sent as written.")}
        {opt("exact", "Exactly as written", "When a question matches a snippet, its answer is sent word for word, whatever your writing style says. A question that only loosely matches gets the same ready-made answer.")}
      </div>
      <p className="note">Compare both without changing the live bot: pick one under "Snippets" in Test the bot.</p>
    </div>
  );
}

function SnippetRows({ q }) {
  const { S } = useStore();
  const [sel, setSel] = useState(() => new Set()); // ids ticked for turning on / off together
  const list = S.snippets.filter((x) => matches(q, x.q, x.a)).sort((a, b) => (b.upd || 0) - (a.upd || 0));
  const picked = S.snippets.filter((x) => sel.has(x.id)).map((x) => x.id); // ticks of deleted snippets don't count
  const allShown = list.length > 0 && list.every((x) => sel.has(x.id));
  const tick = (id) =>
    setSel((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  // The box above the list ticks (or unticks) every snippet shown, so a search narrows what it selects
  const tickShown = () =>
    setSel((cur) => {
      const next = new Set(cur);
      for (const x of list) allShown ? next.delete(x.id) : next.add(x.id);
      return next;
    });
  const turn = async (ids, on, undo) => {
    const r = await api("/api/snippets", { op: "enable", ids, enabled: on });
    setS({ snippets: r.snippets });
    if (undo) return toast("Undone");
    setSel(new Set());
    if (!r.changed.length) return toast(`Those snippets were already ${on ? "on" : "off"}`);
    toast(`${plural(r.changed.length, "snippet")} turned ${on ? "on" : "off"}`, { action: "Undo", onAction: act(() => turn(r.changed, !on, true)) });
  };
  const toggle = async (x) => {
    const r = await api("/api/snippets", { op: "save", item: { ...x, enabled: !x.enabled } });
    setS({ snippets: r.snippets });
    toast(x.enabled ? "Snippet turned off" : "Snippet turned on");
  };
  const del = async (x) => {
    if (!(await confirmBox("Delete snippet?", `"${x.q}" will be deleted and the bot stops using this answer.`))) return;
    const r = await api("/api/snippets", { op: "delete", id: x.id });
    setS({ snippets: r.snippets });
    toast("Snippet deleted");
  };
  if (!list.length) {
    return <div className="empty">{S.snippets.length ? "No snippets match." : "No snippets yet. A snippet is a ready answer for a question customers ask that the help center doesn't cover."}</div>;
  }
  const rows = list.map((x) => (
    <div className="row" key={x.id}>
      <input type="checkbox" className="pick" checked={sel.has(x.id)} onChange={() => tick(x.id)} aria-label={`Select "${x.q}"`} />
      <Switch on={x.enabled} label="The bot uses this snippet" onClick={() => toggle(x)} />
      <div className="grow">
        <button type="button" className="lk t" onClick={() => openSnippet(x.id)}>
          {x.q}
        </button>
        <p className="sub clamp">{x.a}</p>
        <p className="meta">
          {S.settings.snippetMode !== "exact" && x.exact ? (
            <>
              <span className="chip">Sent as written</span>{" "}
            </>
          ) : null}
          {SRC[x.src] || "Written by hand"}, edited {ago(x.upd)}
          {x.by ? ` by ${x.by}` : ""}
        </p>
      </div>
      <div className="acts">
        <button type="button" className="btn ghost sm" onClick={() => pvAsk(x.q)}>
          Test
        </button>
        <button type="button" className="btn ghost sm danger" onClick={act(() => del(x))}>
          Delete
        </button>
      </div>
    </div>
  ));
  return (
    <>
      <div className="row bulk">
        <label className="chk">
          <input type="checkbox" checked={allShown} onChange={tickShown} /> {picked.length ? `${n(picked.length)} selected` : `Select all ${n(list.length)}${q.trim() ? " shown" : ""}`}
        </label>
        {picked.length ? (
          <div className="acts">
            <Btn className="btn sm" onClick={() => turn(picked, true)}>
              Turn on
            </Btn>
            <Btn className="btn sm" onClick={() => turn(picked, false)}>
              Turn off
            </Btn>
            <button type="button" className="btn ghost sm" onClick={() => setSel(new Set())}>
              Clear
            </button>
          </div>
        ) : (
          <span className="meta">Tick snippets to turn several on or off at once.</span>
        )}
      </div>
      {rows}
    </>
  );
}

function ArticleRows({ src, q }) {
  const { S } = useStore();
  const list = S.kb.articles.filter((a) => a.src === src && matches(q, a.title, a.id));
  if (!list.length) {
    return (
      <div className="empty">
        {src === "web" ? "No website pages yet. Click Add website page to let the bot read one, for example your pricing page." : S.kb.articles.length ? "No articles match." : "The help center isn't loaded yet. Click Sync now above."}
      </div>
    );
  }
  const remove = async (a) => {
    if (!(await confirmBox("Remove website page?", `The bot will stop reading ${a.url}.`, "Remove"))) return;
    await kbOp({ op: "removeWeb", id: a.id }, "Page removed");
  };
  const out = [];
  let last = null;
  for (const a of list) {
    const sec = src === "help" ? a.id.split("/")[1] : null;
    if (sec !== last && src === "help") {
      out.push(
        <div className="grp" key={`grp:${a.id}`}>
          {SECTIONS[sec] || sec}
        </div>
      );
      last = sec;
    }
    out.push(
      <div className="row" key={a.id}>
        <Switch on={!a.off} label="The bot uses this article" onClick={() => kbOp({ op: "exclude", id: a.id, excluded: !a.off }, a.off ? "Article turned on, the bot uses it again" : "Article turned off, the bot no longer uses it")} />
        <div className="grow">
          <a className="t" href={a.url} target="_blank" rel="noopener">
            {a.title}
          </a>
          <p className="meta">
            {src === "help" ? a.id : host(a.url) + new URL(a.url).pathname}, {(Math.round(a.chars / 100) / 10).toFixed(1)}k characters{a.off ? ", not used by the bot" : ""}
          </p>
        </div>
        <div className="acts">
          <button type="button" className="btn ghost sm" onClick={act(() => viewArticle(a))}>
            View text
          </button>
          <Btn className="btn ghost sm" busyText="Syncing…" onClick={() => kbOp({ op: "sync", id: a.id }, "Synced the latest version of the article")}>
            Sync page
          </Btn>
          {src === "web" ? (
            <button type="button" className="btn ghost sm danger" onClick={act(() => remove(a))}>
              Remove
            </button>
          ) : null}
        </div>
      </div>
    );
  }
  return out;
}

/* ---------------------------------- Page ---------------------------------- */

export default function Content() {
  const { S, ui, syncing } = useStore();
  const [autoBusy, setAutoBusy] = useState(null); // the Auto sync choice being saved
  const sn = S.snippets;
  const help = S.kb.articles.filter((a) => a.src === "help");
  const web = S.kb.articles.filter((a) => a.src === "web");
  const lastSn = Math.max(0, ...sn.map((x) => x.upd || 0));
  const synced = S.kb.sync?.last?.at || S.kb.builtAt;
  const running = !!S.kb.sync?.running;

  const showTab = (k) => {
    setUI({ tab: k });
    document.getElementById("srcList")?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const setAutoSync = async (e) => {
    const value = e.target.value;
    const label = e.target.selectedOptions[0].textContent;
    setAutoBusy(value);
    try {
      const r = await api("/api/kb", { op: "autoSync", value });
      setS({ kb: r.kb });
      toast(value === "off" ? "Automatic sync turned off. Use Sync now when the help center changes." : `Automatic sync: ${label.toLowerCase()}`);
    } catch (err) {
      fail(err);
    }
    setAutoBusy(null);
  };
  const tab = (k, label) => (
    <button type="button" role="tab" aria-selected={ui.tab === k} onClick={() => showTab(k)}>
      {label}
    </button>
  );
  const srcRow = (k, title, desc, used, total, upd) => (
    <tr className={`click${ui.tab === k ? " sel" : ""}`} onClick={() => showTab(k)}>
      <td>
        <b>{title}</b>
        <div className="meta">{desc}</div>
      </td>
      <td className="num">
        {n(used)}/{n(total)}
      </td>
      <td className="hide-sm">{upd}</td>
    </tr>
  );

  return (
    <>
      <Header title="Knowledge" desc="The bot only answers from the sources that are on. When a snippet and the help center disagree, the bot follows the snippet." />
      <div className="toolbar">
        <button type="button" className="btn pri" onClick={() => openSnippet(null)}>
          New snippet
        </button>
        <button type="button" className="btn" onClick={() => openModal(<ImportDialog />, { focus: "#imp" })}>
          Bulk import
        </button>
        <button type="button" className="btn" onClick={() => openModal(<WebAddDialog />, { focus: "#wu" })}>
          Add website page
        </button>
        <a className="btn" href="#suggestions">
          Suggestions
          {S.pending ? (
            <>
              {" "}
              <span className="badge">{n(S.pending)}</span>
            </>
          ) : null}
        </a>
      </div>
      <section className="sec">
        <div className="sec-h">
          <h2>Content sources</h2>
          <div className="syncbar">
            <label htmlFor="autoSync">Auto sync</label>
            <select className="in inl" id="autoSync" value={autoBusy ?? S.kb.autoSync} disabled={autoBusy != null} onChange={setAutoSync}>
              {AUTO.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <button type="button" className="btn sm" id="syncBtn" disabled={syncing} onClick={syncAll}>
              {syncing ? "Syncing…" : running ? "Continue sync" : "Sync now"}
            </button>
          </div>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Source</th>
              <th className="num">In use</th>
              <th className="hide-sm">Updated</th>
            </tr>
          </thead>
          <tbody>
            {srcRow("snippets", "Snippets", "Questions and answers written by the team", sn.filter((x) => x.enabled).length, sn.length, sn.length ? ago(lastSn) : "never")}
            {srcRow(
              "help",
              "Help center",
              S.kb.helpUrl ? (
                `${host(S.kb.helpUrl)}, ${EVERY[S.kb.autoSync]}`
              ) : (
                <>
                  Not set yet: add the link in{" "}
                  <a href="#settings" onClick={(e) => e.stopPropagation()}>
                    Settings → Product
                  </a>
                </>
              ),
              help.filter((a) => !a.off).length,
              help.length,
              ago(synced)
            )}
            {srcRow("web", "Website pages", `Pages outside the help center, like pricing; ${EVERY[S.kb.autoSync]}`, web.filter((a) => !a.off).length, web.length, web.length ? ago(synced) : "never")}
          </tbody>
        </table>
        <div id="syncNote">
          <SyncNote />
        </div>
      </section>
      <section className="sec" id="srcList">
        <div className="tabs" role="tablist">
          {tab("snippets", `Snippets (${sn.length})`)}
          {tab("help", `Help center (${help.length})`)}
          {tab("web", `Website (${web.length})`)}
        </div>
        <div className="toolbar" style={{ margin: "0 0 12px" }}>
          <input className="in search" type="search" id="cq" placeholder="Search" value={ui.q} onChange={(e) => setUI({ q: e.target.value })} aria-label="Search this list" />
        </div>
        <div id="clist">
          {ui.tab === "snippets" ? <SnippetMode /> : null}
          <div className="rows">{ui.tab === "snippets" ? <SnippetRows q={ui.q} /> : <ArticleRows src={ui.tab} q={ui.q} />}</div>
        </div>
      </section>
    </>
  );
}
