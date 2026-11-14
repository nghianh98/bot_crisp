// Conversations: what customers asked and what the bot replied; filter, search, improve, open in Crisp.
import { useEffect, useState } from "react";
import { Chips, MonthNav, crispUrl } from "../components/common.jsx";
import { openImprove } from "../components/Snippet.jsx";
import { Header } from "../components/ui.jsx";
import { fmtClock, fmtDay, matches, monthLabel, n } from "../lib/format.js";
import { useLog } from "../lib/hooks.js";
import { setUI, shownMonth, useStore } from "../lib/store.js";

const FILTERS = {
  all: ["All", () => true],
  handoff: ["Handed off", (x) => x.act === "handoff"],
  gap: ["Missing knowledge", (x) => x.gap],
  err: ["AI error", (x) => x.err || x.a?.startsWith("Sorry, I couldn't answer that right now.")],
  high: ["P1 / P2", (x) => x.pri === "P1" || x.pri === "P2"],
  urgent: ["Angry customer", (x) => x.urg],
  down: ["Rated not helpful", (x) => x.fb === "down"],
  up: ["Rated helpful", (x) => x.fb === "up"],
};

const sessionFrom = (q) => q.match(/session_[0-9a-f-]{20,}/i)?.[0] || null;

function ConvRow({ x, month }) {
  const [open, setOpen] = useState(false); // the full reply is shown
  return (
    <div className="row conv">
      <div className="when">
        <b>{x.t ? fmtDay(x.t) : ""}</b>
        {x.t ? fmtClock(x.t) : ""}
      </div>
      <div className="grow">
        <p className="qtxt">{x.q || "(the customer sent a file or clicked a button)"}</p>
        {x.a ? (
          <p className={`sub clamp ans${open ? " open" : ""}`} title="Click to see the full reply" onClick={() => setOpen(!open)}>
            {x.a}
          </p>
        ) : (
          <p className="meta">Recorded by the old report, so there's no reply text.</p>
        )}
        <div className="chips">
          <Chips x={x} />
        </div>
      </div>
      <div className="acts">
        <button type="button" className="btn sm" onClick={() => openImprove({ q: x.q, a: x.a, sources: x.src || [], fix: { month, ids: [x.id] } })}>
          Improve
        </button>
        {x.w && x.sid ? (
          <a className="btn ghost sm" href={crispUrl(x)} target="_blank" rel="noopener">
            Open in Crisp
          </a>
        ) : null}
      </div>
    </div>
  );
}

export default function Conversations({ arg }) {
  const s = useStore();
  const { ui } = s;
  const m = shownMonth(s);
  const log = useLog(m);
  // A link like #conversations?down opens with that filter chosen
  useEffect(() => {
    if (arg && FILTERS[arg]) setUI({ cf: arg });
  }, [arg]);
  const head = <Header title="Conversations" desc="Every reply the bot sent to customers. Click Improve to fix an answer for next time." right={<MonthNav />} />;
  if (!log) {
    return (
      <>
        {head}
        <p className="loading">Loading conversations…</p>
      </>
    );
  }
  const items = log.filter((x) => !x.legacy).slice().reverse();
  const sid = sessionFrom(ui.cq);
  const list = items.filter(FILTERS[ui.cf][1]).filter((x) => (sid ? x.sid === sid : matches(ui.cq, x.q, x.a)));
  return (
    <>
      {head}
      <div className="toolbar">
        <div className="fchips" role="group" aria-label="Filter">
          {Object.entries(FILTERS).map(([k, [l, f]]) => (
            <button type="button" key={k} aria-pressed={ui.cf === k} onClick={() => setUI({ cf: k })}>
              {l} ({n(items.filter(f).length)})
            </button>
          ))}
        </div>
      </div>
      <div className="toolbar">
        <input className="in search" type="search" id="cvq" value={ui.cq} onChange={(e) => setUI({ cq: e.target.value })} placeholder="Search the text, or paste a Crisp conversation link" aria-label="Search conversations" />
      </div>
      <section className="sec" style={{ marginTop: 14 }}>
        <div className="rows" id="cvlist">
          {list.length ? (
            <>
              {list.slice(0, 200).map((x) => (
                <ConvRow key={x.id} x={x} month={m} />
              ))}
              {list.length > 200 ? <div className="empty">Showing the 200 newest replies. Use search to narrow it down.</div> : null}
            </>
          ) : (
            <div className="empty">{items.length ? "No conversations match." : `No bot replies in ${monthLabel(m)} yet. When the bot replies to customers, the conversations show up here.`}</div>
          )}
        </div>
      </section>
    </>
  );
}
