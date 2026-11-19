// "Test the bot" panel: chat with the bot using the saved knowledge, and see why it answered as it did.
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { MAX_ATTACH, customerData, pvAsk, pvAttach, pvClose, pvDetach, pvFeedback, pvReset, setPreview, usePreview } from "../lib/preview.js";
import { setS, useStore } from "../lib/store.js";
import { fail, toast } from "../lib/toast.js";
import { Chips, SrcLinks } from "./common.jsx";
import { openImprove } from "./Snippet.jsx";
import { Btn, Modal, closeModal, openModal } from "./ui.jsx";

/** First letter of the bot's name, shown as its avatar */
export const botInitial = (S) => (S?.settings.botName || "T").trim().charAt(0).toUpperCase();

function BotMessage({ m, i, initial }) {
  const r = m.meta;
  return (
    <div className="bot">
      <span className="av" aria-hidden="true">
        {initial}
      </span>
      <div>
        <div className="msg b">{m.content}</div>
        {r?.feedback && !m.fbDone ? (
          <div className="picker" role="group" aria-label={r.feedback.text}>
            <span className="pq">{r.feedback.text}</span>
            <button type="button" onClick={() => pvFeedback(i, "yes")}>
              {r.feedback.yes}
            </button>
            <button type="button" onClick={() => pvFeedback(i, "no")}>
              {r.feedback.no}
            </button>
          </div>
        ) : null}
        {r ? (
          <div className="trace">
            <div className="chips">
              <Chips x={{ act: r.action, cat: r.category, urg: r.urgent, gap: r.knowledge_gap, pri: r.priority, img: r.images }} />
            </div>
            {r.imagesFailed ? <div>The AI couldn't open the image, so it answered without seeing it ({r.imagesFailed}).</div> : null}
            <div>
              Sources: <SrcLinks sources={r.sources} />
            </div>
            {r.kb ? (
              <div className="muted" title={(r.kb.titles || []).join("\n")}>
                Read {r.kb.used} of {r.kb.total} help center articles{r.kb.question ? `, searching for: ${r.kb.question}` : ""}
              </div>
            ) : null}
            {r.teamNote ? (
              <details className="tnote" open>
                <summary>Note for the team (only the team sees it)</summary>
                <pre>{r.teamNote}</pre>
              </details>
            ) : null}
            <div>
              <button type="button" className="lk" onClick={() => openImprove({ q: m.q, a: m.content, sources: r.sources || [] })}>
                Improve this answer
              </button>{" "}
              <span className="muted">{(r.ms / 1000).toFixed(1)} s</span>
            </div>
          </div>
        ) : m.note ? (
          <div className="trace">
            <div>{m.note}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// The team's saved test questions (one per line): shortcuts shown when the panel is empty
function QuestionsDialog() {
  const { S } = useStore();
  const max = S.meta.maxTestQuestions;
  const [text, setText] = useState(() => (S.testQuestions || []).join("\n"));
  const save = async () => {
    const testQuestions = text.split("\n").map((l) => l.trim()).filter(Boolean);
    setS(await api("/api/settings", { testQuestions }));
    closeModal();
    toast("Test questions saved");
  };
  return (
    <Modal
      title="Test questions"
      footer={
        <>
          <button className="btn" value="close">
            Cancel
          </button>
          <Btn className="btn pri" onClick={save}>
            Save questions
          </Btn>
        </>
      }
    >
      <p className="hint" style={{ margin: "0 0 10px" }}>
        Questions your customers really ask, one per line (up to {max}). They appear as shortcuts in this panel so you can re-check the bot after every change.
      </p>
      <textarea className="in" id="pvQs" rows={10} maxLength={3000} value={text} onChange={(e) => setText(e.target.value)} placeholder={"How do I get started?\nI was charged twice, I want a refund\nCan I talk to a person?"} />
    </Modal>
  );
}

export default function Preview() {
  const { S } = useStore();
  const P = usePreview();
  const log = useRef(null);
  const ta = useRef(null);
  const form = useRef(null);
  const initial = botInitial(S);
  const qs = S?.testQuestions || [];
  const custN = Object.keys(customerData(P.cust)).length;

  // Keep the newest message in view
  useEffect(() => {
    if (P.msgs.length) log.current.scrollTop = log.current.scrollHeight;
  }, [P.msgs, P.busy]);
  // Opening the panel (or Reset) puts the cursor in the question box
  useEffect(() => {
    if (!P.focus) return;
    const t = setTimeout(() => ta.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [P.focus]);

  const file = useRef(null);
  const send = (e) => {
    e.preventDefault();
    if (P.busy) return;
    const v = ta.current.value;
    const att = P.att;
    ta.current.value = "";
    ta.current.style.height = "";
    setPreview({ att: [] });
    pvAsk(v, att);
  };
  const attach = (files) => pvAttach([...files].filter((f) => f.type.startsWith("image/"))).catch(fail);
  // A screenshot pasted into the question box is attached, the way a customer would send it
  const paste = (e) => {
    const imgs = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    e.preventDefault();
    attach(imgs);
  };
  const grow = () => {
    ta.current.style.height = "";
    ta.current.style.height = `${Math.min(140, ta.current.scrollHeight)}px`;
  };
  const enter = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      form.current.requestSubmit();
    }
  };

  return (
    <section className={`pv${P.open ? " open" : ""}`} id="pv" aria-label="Test the bot">
      <header className="pv-h">
        <div>
          <h2>Test the bot</h2>
          <p>Uses the saved knowledge and guidance. Nothing is sent to real customers.</p>
        </div>
        <div className="pv-a">
          <button className="btn ghost sm" type="button" onClick={pvReset}>
            Reset
          </button>
          <button className="btn ghost sm pv-close" type="button" aria-label="Close test panel" onClick={pvClose}>
            ✕
          </button>
        </div>
      </header>
      <label className="pv-opt">
        <input type="checkbox" id="pvHand" checked={P.hand} onChange={(e) => setPreview({ hand: e.target.checked })} /> Pretend the conversation was already handed off
      </label>
      <label className="pv-opt" htmlFor="pvSnip">
        Snippets{" "}
        <select id="pvSnip" value={P.snip} onChange={(e) => setPreview({ snip: e.target.value })}>
          <option value="">as saved</option>
          <option value="knowledge">try: as knowledge</option>
          <option value="exact">try: exactly as written</option>
        </select>
      </label>
      <details className="pv-cust">
        <summary>
          Customer data from the app <span id="pvCustN">{custN ? `(${custN})` : ""}</span>
        </summary>
        <p>
          What your app sends to Crisp, one per line as <code>key: value</code>. The bot uses it and never asks for it.
        </p>
        <textarea id="pvCust" rows={4} spellCheck={false} value={P.cust} onChange={(e) => setPreview({ cust: e.target.value })} placeholder={"account_id: 12345\nplan: premium\nsigned_up: 2026-03-01"} />
      </details>
      <div className="pv-log" id="pvLog" aria-live="polite" ref={log}>
        {!S ? null : !P.msgs.length ? (
          <div className="starters">
            <p>{qs.length ? "Type a question customers often ask, or try one:" : "Type a question the way a customer would. Save the ones you ask often to try them again in one click."}</p>
            {qs.map((q, i) => (
              <button type="button" key={i} onClick={() => pvAsk(q)}>
                {q}
              </button>
            ))}
            <p>
              <button type="button" className="lk" onClick={() => openModal(<QuestionsDialog />, { focus: "#pvQs" })}>
                {qs.length ? "Edit questions" : "Add test questions"}
              </button>
            </p>
          </div>
        ) : (
          <>
            {P.msgs.map((m, i) =>
              m.role === "user" ? (
                <div className="msg u" key={i}>
                  {m.text ?? m.content}
                  {(m.images || []).map((src, k) => (
                    <img key={k} src={src} alt="Attached screenshot" />
                  ))}
                </div>
              ) : m.role === "error" ? (
                <div className="pv-err" key={i}>
                  {m.content}
                </div>
              ) : (
                <BotMessage key={i} m={m} i={i} initial={initial} />
              )
            )}
            {P.busy ? (
              <div className="bot">
                <span className="av" aria-hidden="true">
                  {initial}
                </span>
                <div className="msg b typing" aria-label="The bot is replying">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
      <div className="pv-att">
        {P.att.map((a, i) => (
          <span className="pv-thumb" key={i}>
            <img src={a.src} alt={a.name} />
            <button type="button" aria-label={`Remove ${a.name}`} onClick={() => pvDetach(i)}>
              ✕
            </button>
          </span>
        ))}
        {P.att.length < MAX_ATTACH ? (
          <button type="button" className="lk" onClick={() => file.current.click()}>
            Attach a screenshot
          </button>
        ) : null}
        <span className="muted">{P.att.length ? "" : "or paste one into the box"}</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          ref={file}
          onChange={(e) => {
            const picked = [...e.target.files];
            e.target.value = ""; // the same file can be picked again
            attach(picked);
          }}
        />
      </div>
      <form className="pv-in" id="pvForm" ref={form} onSubmit={send}>
        <textarea id="pvText" rows={1} placeholder="Ask like a customer would" aria-label="Customer question" ref={ta} onKeyDown={enter} onInput={grow} onPaste={paste} />
        <button className="btn pri" type="submit">
          Send
        </button>
      </form>
    </section>
  );
}
