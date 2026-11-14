// Suggestions: questions the bot had no knowledge for; AI grouping; create a snippet or dismiss.
import { useEffect } from "react";
import { MonthNav } from "../components/common.jsx";
import { openImprove } from "../components/Snippet.jsx";
import { Btn, Header } from "../components/ui.jsx";
import { api } from "../lib/api.js";
import { fmtClock, fmtDay, monthLabel, n, plural } from "../lib/format.js";
import { useLog } from "../lib/hooks.js";
import { get, set, setS, shownMonth, useStore } from "../lib/store.js";
import { toast } from "../lib/toast.js";

/** Mark logged questions as dismissed / fixed, or clear the mark (st = null) */
async function setStatus(m, ids, st) {
  await api("/api/log", { month: m, ids, st });
  set((s) => ({
    log: {
      ...s.log,
      [m]: (s.log[m] || []).map((x) => {
        if (!ids.includes(x.id)) return x;
        const { st: _old, ...rest } = x;
        return st ? { ...rest, st } : rest;
      }),
    },
  }));
}

export default function Suggestions() {
  const s = useStore();
  const { S, ui } = s;
  const m = shownMonth(s);
  const items = useLog(m);
  const pendingCount = items ? items.filter((x) => x.gap && !x.st).length : null;
  // The badge in the menu follows what this page shows
  useEffect(() => {
    if (pendingCount != null && m === S.month && S.pending !== pendingCount) setS({ pending: pendingCount });
  }, [pendingCount, m, S.month, S.pending]);

  const head = <Header title="Suggestions" desc="Questions customers asked that the bot had no knowledge to answer. Add a snippet so the bot can answer next time." right={<MonthNav />} />;
  if (!items) {
    return (
      <>
        {head}
        <p className="loading">Loading…</p>
      </>
    );
  }
  const pending = items.filter((x) => x.gap && !x.st).reverse();
  const done = items.filter((x) => x.gap && x.st).reverse();
  const groups = ui.groups[m];
  const byId = Object.fromEntries(items.map((x) => [x.id, x]));

  const group = async () => {
    const r = await api("/api/suggest", { month: m });
    set((cur) => ({ ui: { ...cur.ui, groups: { ...cur.ui.groups, [m]: r.groups } } }));
  };
  const fix = (x) => openImprove({ q: x.q, a: x.a, sources: x.src || [], fix: { month: m, ids: [x.id] } });
  const fixGroup = (g) => {
    const open = g.ids.filter((id) => (get().log[m] || []).some((x) => x.id === id && !x.st));
    openImprove({ q: g.question, fix: { month: m, ids: open } });
  };
  const skip = async (x) => {
    await setStatus(m, [x.id], "dismissed");
    toast("Question dismissed");
  };
  const row = (x, isDone) => (
    <div className="row conv" key={x.id}>
      <div className="when">
        <b>{x.t ? fmtDay(x.t) : ""}</b>
        {x.t ? fmtClock(x.t) : ""}
      </div>
      <div className="grow">
        <p className="qtxt">{x.q}</p>
        {isDone ? <div className="chips">{x.st === "fixed" ? <span className="chip c-answer">Snippet added</span> : <span className="chip">Dismissed</span>}</div> : null}
      </div>
      <div className="acts">
        {isDone ? (
          <Btn className="btn ghost sm" onClick={() => setStatus(m, [x.id], null)}>
            Undo
          </Btn>
        ) : (
          <>
            <button type="button" className="btn sm pri" onClick={() => fix(x)}>
              Create snippet
            </button>
            <Btn className="btn ghost sm" onClick={() => skip(x)}>
              Dismiss
            </Btn>
          </>
        )}
      </div>
    </div>
  );
  const groupRows = groups
    ? groups
        .map((g, i) => {
          const qs = g.ids.map((id) => byId[id]).filter((x) => x && !x.st);
          if (!qs.length) return null;
          return (
            <div className="row" key={i}>
              <div className="grow">
                <p className="t">
                  {g.title} <span className="chip c-gap">{plural(qs.length, "question")}</span>
                </p>
                <p className="sub">Suggested snippet question: {g.question}</p>
                <ul className="samples">
                  {qs.slice(0, 3).map((x) => (
                    <li key={x.id}>{x.q}</li>
                  ))}
                </ul>
              </div>
              <div className="acts">
                <button type="button" className="btn sm pri" onClick={() => fixGroup(g)}>
                  Create snippet for group
                </button>
              </div>
            </div>
          );
        })
        .filter(Boolean)
    : null;

  return (
    <>
      {head}
      <section className="sec">
        <div className="sec-h">
          <h2>Missing knowledge, grouped</h2>
          <Btn className="btn sm" busyText="The AI is reading…" disabled={pending.length < 2} onClick={group}>
            {groups ? "Group again" : "Group with AI"}
          </Btn>
        </div>
        {groups ? (
          groups.length ? (
            <div className="rows groups">{groupRows.length ? groupRows : <div className="empty">Every group has been handled.</div>}</div>
          ) : (
            <div className="rows">
              <div className="empty">The AI didn't find any groups.</div>
            </div>
          )
        ) : (
          <p className="hint">
            The AI reads the open questions and groups them by the knowledge that's missing, so you can write one snippet for the whole group.{pending.length < 2 ? " You need at least 2 open questions." : ""}
          </p>
        )}
      </section>
      <section className="sec">
        <h2>
          Open <span className="cnt">{n(pending.length)}</span>
        </h2>
        <div className="rows">{pending.length ? pending.map((x) => row(x, false)) : <div className="empty">Nothing left for {monthLabel(m)}. The bot has knowledge for every question customers asked.</div>}</div>
      </section>
      {done.length ? (
        <section className="sec">
          <details>
            <summary className="t" style={{ cursor: "pointer" }}>
              Handled ({n(done.length)})
            </summary>
            <div className="rows" style={{ marginTop: 10 }}>
              {done.map((x) => row(x, true))}
            </div>
          </details>
        </section>
      ) : null}
    </>
  );
}
