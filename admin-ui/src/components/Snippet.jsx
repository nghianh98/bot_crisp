// The snippet editor and "Improve this answer": opened from Knowledge, Conversations, Suggestions and the Test panel.
import { useState } from "react";
import { api } from "../lib/api.js";
import { words } from "../lib/format.js";
import { pvAsk } from "../lib/preview.js";
import { get, set, useStore } from "../lib/store.js";
import { toast } from "../lib/toast.js";
import { srcInfo } from "./common.jsx";
import { Btn, Modal, closeModal, openModal } from "./ui.jsx";

/**
 * Save a snippet. fix: { month, ids } marks those logged questions as handled;
 * retry: a question to offer in the toast ("Test this question").
 */
async function saveSnippet(item, { fix = null, retry = null } = {}) {
  const r = await api("/api/snippets", { op: "save", item: { ...item, id: item.id || undefined, src: fix ? "gap" : undefined }, fixLog: fix || undefined });
  set((s) => {
    const next = { S: { ...s.S, snippets: r.snippets } };
    const log = fix && s.log[fix.month];
    if (log) {
      const marked = log.map((it) => (fix.ids.includes(it.id) ? { ...it, st: "fixed" } : it));
      next.log = { ...s.log, [fix.month]: marked };
      if (fix.month === s.S.month) next.S.pending = marked.filter((x) => x.gap && !x.st).length;
    }
    return next;
  });
  closeModal();
  toast("Snippet saved. The bot uses it from the next message.", retry ? { action: "Test this question", onAction: () => pvAsk(retry) } : {});
}

/* -------------------------------- Snippet -------------------------------- */

function SnippetDialog({ id }) {
  const { S } = useStore();
  const [prev] = useState(() => S.snippets.find((s) => s.id === id));
  const [x, setX] = useState(() => ({ q: prev?.q || "", a: prev?.a || "", enabled: prev ? !!prev.enabled : true, exact: !!prev?.exact }));
  const allExact = S.settings.snippetMode === "exact";
  const up = (k) => (e) => setX({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  // No tick box on screen (all snippets are sent as written): keep what the snippet had
  const save = () => saveSnippet({ id, q: x.q, a: x.a, enabled: x.enabled, exact: allExact ? !!prev?.exact : x.exact });
  return (
    <Modal
      title={id ? "Edit snippet" : "New snippet"}
      footer={
        <>
          <button className="btn" value="close">
            Cancel
          </button>
          <Btn className="btn pri" onClick={save}>
            Save snippet
          </Btn>
        </>
      }
    >
      <label className="fl" htmlFor="sq">
        Customer question
      </label>
      <input className="in" id="sq" value={x.q} onChange={up("q")} maxLength={300} placeholder="For example: Do you offer free setup?" />
      <label className="fl" htmlFor="sa">
        Answer
      </label>
      <textarea className="in" id="sa" rows={8} maxLength={2000} value={x.a} onChange={up("a")} placeholder="Write the facts the answer needs. The bot rewords it in its usual reply format." />
      <p className="meta">
        <span id="sc">{x.a.length}</span>/2000 characters. English or Vietnamese both work.
      </p>
      <label className="chk">
        <input type="checkbox" id="se" checked={x.enabled} onChange={up("enabled")} /> The bot uses this snippet
      </label>
      {allExact ? (
        <p className="meta">All snippets are sent exactly as written (see "How the bot uses snippets" above the list).</p>
      ) : (
        <label className="chk">
          <input type="checkbox" id="sx" checked={x.exact} onChange={up("exact")} /> Always send this answer exactly as written <span className="muted">(for approved wording, like a policy)</span>
        </label>
      )}
    </Modal>
  );
}

export function openSnippet(id) {
  openModal(<SnippetDialog id={id || null} />, { focus: id ? "#sa" : "#sq" });
}

/* --------------------------- Improve this answer --------------------------- */

const STOP = new Set("the and for you your can how what why does with this that are not have from when where which will about there their into store app".split(" "));

// Snippets closest to the question: sources the bot used first, then snippets sharing the most words
function related(S, q, sources = []) {
  const used = sources.map((s) => srcInfo(s, S)).filter((x) => x?.kind === "snippet").map((x) => x.id);
  const toks = new Set(words(q).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));
  const score = (s) => {
    const w = new Set(words(`${s.q} ${s.a}`).split(/[^a-z0-9]+/));
    let k = 0;
    for (const t of toks) if (w.has(t)) k++;
    return k;
  };
  return S.snippets
    .map((s) => ({ s, k: used.includes(s.id) ? 100 : score(s) }))
    .filter((x) => x.k > 0)
    .sort((a, b) => b.k - a.k)
    .slice(0, 6)
    .map((x) => ({ ...x.s, used: used.includes(x.s.id) }));
}

function ImproveDialog({ q, a, sources, fix }) {
  const { S } = useStore();
  const [x, setX] = useState({ q, a: "", enabled: true });
  const rel = related(S, q, sources);
  const arts = sources.map((s) => srcInfo(s, S)).filter((s) => s && s.kind !== "snippet");
  const save = () => saveSnippet({ q: x.q, a: x.a, enabled: x.enabled, exact: false }, { fix, retry: q });
  return (
    <Modal
      title="Improve this answer"
      footer={
        <button className="btn" value="close">
          Close
        </button>
      }
    >
      {q || a ? (
        <div className="ctx">
          {q ? (
            <>
              <b>Customer asked</b>
              <p>{q}</p>
            </>
          ) : null}
          {a ? (
            <>
              <b>Bot answered</b>
              <p>{a}</p>
            </>
          ) : null}
        </div>
      ) : null}
      <h3>Create a new snippet</h3>
      <p className="hint">Next time a customer asks something similar, the bot answers from this snippet.</p>
      <label className="fl" htmlFor="sq">
        Question
      </label>
      <input className="in" id="sq" value={x.q} onChange={(e) => setX({ ...x, q: e.target.value })} maxLength={300} />
      <label className="fl" htmlFor="sa">
        Answer
      </label>
      <textarea className="in" id="sa" rows={6} maxLength={2000} value={x.a} onChange={(e) => setX({ ...x, a: e.target.value })} placeholder="Write the facts the answer needs." />
      <label className="chk">
        <input type="checkbox" id="se" checked={x.enabled} onChange={(e) => setX({ ...x, enabled: e.target.checked })} /> Turn on now
      </label>
      <p style={{ margin: "12px 0 0" }}>
        <Btn className="btn pri" onClick={save}>
          Save snippet
        </Btn>
      </p>
      <h3>Or update related content</h3>
      <div className="rows">
        {rel.length || arts.length ? (
          <>
            {rel.map((s) => (
              <div className="row" key={s.id}>
                <div className="grow">
                  <p className="t">
                    {s.q}
                    {s.used ? (
                      <>
                        {" "}
                        <span className="chip c-handoff">Used by the bot</span>
                      </>
                    ) : null}
                  </p>
                  <p className="sub clamp">{s.a}</p>
                </div>
                <div className="acts">
                  <button type="button" className="btn sm" onClick={() => openSnippet(s.id)}>
                    Edit
                  </button>
                </div>
              </div>
            ))}
            {arts.map((s, i) => (
              <div className="row" key={i}>
                <div className="grow">
                  <p className="t">
                    {s.title} <span className="chip">Used by the bot</span>
                  </p>
                  <p className="sub">An article the bot read. Edit it on the help center or website, then click Sync now in Knowledge.</p>
                </div>
                <div className="acts">
                  <a className="btn sm" href={s.url} target="_blank" rel="noopener">
                    Open article
                  </a>
                </div>
              </div>
            ))}
          </>
        ) : (
          <div className="empty">No snippets are close to this question.</div>
        )}
      </div>
    </Modal>
  );
}

/** q: customer question; a: the bot's answer; sources: what the bot used; fix: { month, ids } to mark as handled on save */
export function openImprove({ q = "", a = "", sources = [], fix = null }) {
  openModal(<ImproveDialog q={q} a={a} sources={sources} fix={fix && fix.ids?.length ? fix : null} />, { wide: true, focus: "#sa" });
}

export const logItem = (month, id) => (get().log[month] || []).find((x) => x.id === id);
