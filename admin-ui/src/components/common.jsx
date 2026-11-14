// Pieces used on several pages: labels of a bot reply, month switch, sources the bot used, figures and charts.
import { Fragment, useEffect, useRef } from "react";
import { monthLabel, n, shiftMonth } from "../lib/format.js";
import { get, setUI, shownMonth, tagFull, tagLabel, useStore } from "../lib/store.js";
import { openSnippet } from "./Snippet.jsx";

export const ACTIONS = { answer: ["Answered", "c-answer"], ask_info: ["Asked for details", "c-ask"], handoff: ["Handed off", "c-handoff"] };

/** Labels for one bot reply (conversation log or the Test panel) */
export function Chips({ x }) {
  const out = [];
  const chip = (cls, text, title) => out.push(<span key={out.length} className={`chip${cls ? ` ${cls}` : ""}`} title={title}>{text}</span>);
  if (x.act && ACTIONS[x.act]) chip(ACTIONS[x.act][1], ACTIONS[x.act][0]);
  if (x.pri === "P1" || x.pri === "P2") chip(x.pri === "P1" ? "c-urgent" : "c-gap", x.pri, `Priority: ${x.pri === "P1" ? "critical" : "high"}`);
  if (x.cat) chip("c-tag", tagFull(x.cat), tagLabel(x.cat));
  if (x.err) chip("c-urgent", "AI error", `The AI failed, so the customer got the backup reply: ${x.err}`);
  if (x.img) chip("", x.img === 1 ? "Looked at 1 image" : `Looked at ${x.img} images`, "Images the customer sent that the AI saw for this reply");
  if (x.urg) chip("c-urgent", "Angry customer");
  if (x.gap) chip("c-gap", "Missing knowledge");
  if (x.fb === "up") chip("c-answer", "Rated helpful");
  if (x.fb === "down") chip("c-urgent", "Rated not helpful");
  if (x.st === "fixed") chip("", "Improved");
  if (x.st === "dismissed") chip("", "Dismissed");
  return out;
}

/** ‹ November 2026 › : the month shown on Performance, Conversations and Suggestions */
export function MonthNav() {
  const s = useStore();
  const m = shownMonth(s);
  const go = (d) => setUI({ month: shiftMonth(m, d) });
  return (
    <div className="mnav" role="group" aria-label="Choose month">
      <button type="button" className="btn ghost sm" aria-label="Previous month" onClick={() => go(-1)}>
        ‹
      </button>
      <b>{monthLabel(m)}</b>
      <button type="button" className="btn ghost sm" aria-label="Next month" disabled={m >= s.S.month} onClick={() => go(1)}>
        ›
      </button>
    </div>
  );
}

export const crispUrl = (x) => `https://app.crisp.chat/website/${encodeURIComponent(x.w)}/inbox/${encodeURIComponent(x.sid)}/`;

/* ---------------------------- Sources the bot used ---------------------------- */

/** A source id the AI returned → the snippet, article or link it points to */
export function srcInfo(s, S = get().S) {
  const sn = S.snippets.find((x) => x.id === s);
  if (sn) return { kind: "snippet", id: sn.id, title: sn.q };
  const clean = String(s).replace(/[#?].*$/, "").replace(/\/$/, "");
  const a = S.kb.articles.find((x) => x.url.replace(/\/$/, "") === clean || (x.src === "help" && clean.endsWith(x.id.replace(/\/$/, ""))));
  if (a) return { kind: "article", id: a.id, url: a.url, title: a.title, off: a.off };
  if (/^https?:\/\//.test(s)) return { kind: "link", url: s, title: s.replace(/^https?:\/\//, "") };
  return null;
}

export function SrcLinks({ sources }) {
  const list = (sources || []).map((s) => srcInfo(s)).filter(Boolean);
  if (!list.length) return "none";
  return list.map((s, i) => (
    <Fragment key={i}>
      {i ? ", " : ""}
      {s.kind === "snippet" ? (
        <button type="button" className="lk" onClick={() => openSnippet(s.id)}>
          Snippet: {s.title}
        </button>
      ) : (
        <a href={s.url} target="_blank" rel="noopener">
          {s.title}
        </a>
      )}
    </Fragment>
  ));
}

/* --------------------------------- Charts --------------------------------- */

export function Fig({ value, label, sub }) {
  return (
    <div className="fig">
      <b>{value}</b>
      <span>{label}</span>
      {sub ? <small>{sub}</small> : null}
    </div>
  );
}

function niceTicks(max) {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  const step = steps.find((s) => max / s <= 4) || Math.ceil(max / 4);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const out = [];
  for (let v = 0; v <= top; v += step) out.push(v);
  return out;
}

/** One bar per day, one colour, tooltip on hover or focus */
export function DailyChart({ days, value, tipText, label }) {
  const max = Math.max(1, ...days.map(value));
  const ticks = niceTicks(max);
  const top = ticks.at(-1);
  return (
    <div className="chart" role="img" aria-label={label}>
      <div className="plot">
        {ticks.map((t) => (
          <div key={t} className={`gl${t === 0 ? " base" : ""}`} style={{ bottom: `${(t / top) * 100}%` }}>
            <span>{n(t)}</span>
          </div>
        ))}
        <div className="cols">
          {days.map((d) => (
            <div key={d.d} className="col" tabIndex={0} data-tip={tipText(d)}>
              <i style={{ height: `${(value(d) / top) * 100}%` }} />
            </div>
          ))}
        </div>
      </div>
      <div className="xax" aria-hidden="true">
        {days.map((d) => (
          <span key={d.d}>{d.d === 1 || d.d % 5 === 0 ? d.d : ""}</span>
        ))}
      </div>
    </div>
  );
}

export function Funnel({ steps }) {
  const base = steps[0].v || 0;
  return (
    <div className="fun">
      {steps.map((s) => {
        const w = base ? (s.v / base) * 100 : 0;
        return (
          <div className="fs" key={s.label}>
            <span>{s.label}</span>
            <div className="fb">
              <i style={{ width: `${w}%` }} />
            </div>
            <div className="fv">
              {n(s.v)}
              <small>{base ? `${Math.round(w)}%` : ""}</small>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Tooltip for anything with data-tip (chart bars): shown on hover or keyboard focus */
export function Tip() {
  const ref = useRef(null);
  useEffect(() => {
    const tip = ref.current;
    const show = (el) => {
      const r = el.getBoundingClientRect();
      tip.textContent = el.dataset.tip;
      tip.style.left = `${Math.min(window.innerWidth - 130, Math.max(130, r.left + r.width / 2))}px`;
      tip.style.top = `${r.top + Math.max(0, r.height - (el.firstElementChild?.offsetHeight || 0))}px`;
      tip.classList.add("on");
    };
    const hide = () => tip.classList.remove("on");
    const over = (e) => {
      const c = e.target.closest?.("[data-tip]");
      c ? show(c) : hide();
    };
    const focus = (e) => (e.target.matches?.("[data-tip]") ? show(e.target) : hide());
    document.addEventListener("mouseover", over);
    document.addEventListener("focusin", focus);
    document.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("mouseover", over);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("scroll", hide, true);
    };
  }, []);
  return <div className="tip" id="tip" role="tooltip" ref={ref} />;
}
