// Conversations: what customers asked and what the bot replied; filter, search, improve, delete, open in Crisp.
import { useEffect, useState } from "react";
import { Chips, MonthNav, crispUrl } from "../components/common.jsx";
import { openImprove } from "../components/Snippet.jsx";
import { Btn, Header, Modal, More, closeModal, confirmBox, openModal } from "../components/ui.jsx";
import { api } from "../lib/api.js";
import { fmtClock, fmtDay, matches, monthLabel, n, plural } from "../lib/format.js";
import { useLog } from "../lib/hooks.js";
import { set, setS, setUI, shownMonth, useStore } from "../lib/store.js";
import { toast } from "../lib/toast.js";

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

const replies = (k) => plural(k, "reply", "replies");

/**
 * Delete bot replies for good (for example a chat the team used for testing). They leave Conversations, Suggestions and
 * the month's numbers; a conversation with no reply left is taken out of the numbers completely. There is no undo.
 */
async function removeReplies(m, ids) {
  await api("/api/log", { month: m, ids, remove: true });
  set((s) => ({ log: { ...s.log, [m]: (s.log[m] || []).filter((x) => !ids.includes(x.id)) }, an: { ...s.an, [m]: undefined } }));
  toast(`${replies(ids.length)} deleted`);
  // Overview (latest replies) and the Suggestions count follow
  api("/api/state")
    .then(setS)
    .catch(() => {});
}

/** Delete one reply, or with the box ticked every reply of that conversation */
function DeleteDialog({ x, month, others }) {
  const [whole, setWhole] = useState(false);
  const go = async () => {
    await removeReplies(month, whole ? [x.id, ...others] : [x.id]);
    closeModal();
  };
  return (
    <Modal
      title="Delete reply?"
      footer={
        <>
          <button className="btn" value="close">
            Cancel
          </button>
          <Btn className="btn pri danger" onClick={go}>
            {whole ? `Delete ${replies(others.length + 1)}` : "Delete"}
          </Btn>
        </>
      }
    >
      <p style={{ margin: 0 }}>
        "{(x.q || "(a file or a button click)").slice(0, 90)}" and the bot's reply will be deleted from Conversations, Suggestions and this month's numbers. This can't be undone. The chat in Crisp stays as it is.
      </p>
      {others.length ? (
        <label className="chk" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} /> Delete the whole conversation: {replies(others.length + 1)} this month
        </label>
      ) : null}
    </Modal>
  );
}

function ConvRow({ x, month, picked, onPick, others }) {
  const [open, setOpen] = useState(false); // the full reply is shown
  return (
    <div className="row conv">
      <input type="checkbox" className="pick" checked={picked} onChange={onPick} aria-label={`Select the reply to "${(x.q || "a file").slice(0, 60)}"`} />
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
        <More label="More actions for this reply">
          {x.w && x.sid ? (
            <a href={crispUrl(x)} target="_blank" rel="noopener">
              Open in Crisp
            </a>
          ) : null}
          <button type="button" className="danger" onClick={() => openModal(<DeleteDialog x={x} month={month} others={others} />)}>
            Delete
          </button>
        </More>
      </div>
    </div>
  );
}

export default function Conversations({ arg }) {
  const s = useStore();
  const { ui } = s;
  const m = shownMonth(s);
  const log = useLog(m);
  const [sel, setSel] = useState(() => new Set()); // ids ticked for deleting together
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
  const shown = list.slice(0, 200);
  const picked = items.filter((x) => sel.has(x.id)).map((x) => x.id); // ticks of another month or of deleted replies don't count
  const allShown = shown.length > 0 && shown.every((x) => sel.has(x.id));
  const tick = (id) =>
    setSel((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  // Ticks (or unticks) every reply shown, so a filter, a search or a pasted Crisp link narrows what it selects
  const tickShown = () =>
    setSel((cur) => {
      const next = new Set(cur);
      for (const x of shown) allShown ? next.delete(x.id) : next.add(x.id);
      return next;
    });
  const delPicked = async () => {
    const one = picked.length === 1;
    if (!(await confirmBox(`Delete ${replies(picked.length)}?`, `${one ? "It" : "They"} will be deleted from Conversations, Suggestions and this month's numbers. This can't be undone. The ${one ? "chat in Crisp stays as it is" : "chats in Crisp stay as they are"}.`))) return;
    await removeReplies(m, picked);
    setSel(new Set());
  };
  // The other replies of the same conversation this month (for "Delete the whole conversation")
  const sameChat = (x) => (x.sid ? items.filter((y) => y.sid === x.sid && y.id !== x.id).map((y) => y.id) : []);
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
              <div className="row bulk">
                <label className="chk">
                  <input type="checkbox" checked={allShown} onChange={tickShown} /> {picked.length ? `${n(picked.length)} selected` : `Select all ${n(shown.length)} shown`}
                </label>
                {picked.length ? (
                  <div className="acts">
                    <Btn className="btn sm danger" onClick={delPicked}>
                      Delete
                    </Btn>
                    <button type="button" className="btn ghost sm" onClick={() => setSel(new Set())}>
                      Clear
                    </button>
                  </div>
                ) : (
                  <span className="meta">Tick replies to delete several at once, for example a test chat.</span>
                )}
              </div>
              {shown.map((x) => (
                <ConvRow key={x.id} x={x} month={m} picked={sel.has(x.id)} onPick={() => tick(x.id)} others={sameChat(x)} />
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
