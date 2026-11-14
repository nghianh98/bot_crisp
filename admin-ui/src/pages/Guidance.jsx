// Guidance: tell the bot how to talk and handle situations, grouped, with templates to start from.
import { useRef, useState } from "react";
import { Btn, Header, Modal, Switch, act, closeModal, confirmBox, openModal } from "../components/ui.jsx";
import { api } from "../lib/api.js";
import { ago } from "../lib/format.js";
import { setS, useStore } from "../lib/store.js";
import { toast } from "../lib/toast.js";

const TEMPLATES = {
  tone: [
    ["Friendly", "Friendly and warm, like a helpful colleague. Use the customer's name when you know it."],
    ["Professional", "Professional and polite. Clear, calm and confident. No slang."],
    ["Very concise", "Very concise: give the answer in the first sentence, no small talk."],
    ["Allow emoji", "You may use at most one friendly emoji per message (for example 🙂 or 🙌), never in apologies."],
    ["Patient with beginners", "Be patient with beginners: explain technical terms simply and never make the customer feel stupid."],
    ["Don't over-apologise", "Apologise at most once per conversation, then focus on the solution."],
  ],
  clarify: [
    ["Ask when the question is vague", "If the question is vague (for example 'it doesn't work'), ask one short question to understand what they mean before answering."],
    ["Ask for their plan", "When the answer depends on the customer's plan, ask which plan they are on."],
    ["Ask where a display problem shows", "For display problems, ask which page and which device or browser before suggesting steps."],
  ],
  content: [
    ["Don't compare competitors", "Do not compare the product with other apps unless the customer asks."],
    ["Link pricing for price questions", "When the customer asks about price or plans, always include the pricing page link."],
    ["Don't promise upcoming features", "Never promise features or release dates. Say the team has noted the request."],
  ],
  handoff: [
    ["Say when the team replies", "When handing off, tell the customer the team usually replies within a few hours during working hours."],
    ["Offer email outside hours", "When handing off outside working hours, also offer the support email."],
  ],
  other: [
    ["Refunds", "If the customer asks for a refund, do not promise anything. Collect the account details and the reason, then hand off."],
    ["Feature requests", "If the customer asks for a feature we do not have, thank them and say the request is passed to the product team."],
  ],
};

const FIXED = [
  "Answers only from snippets, the help center and website pages; never invents features, prices or links.",
  "Replies in the language chosen in Settings.",
  "Plain text only: the chat doesn't show markdown. Length, format and voice follow your rules on the Writing style page.",
  "Never asks for passwords, staff logins, API keys or card numbers.",
  "Says honestly that it is an AI assistant when a customer asks.",
];

function GuidanceDialog({ id, cat }) {
  const { S } = useStore();
  const cats = S.meta.guidanceCats;
  const [g, setG] = useState(() => {
    const x = S.guidance.find((it) => it.id === id) || { cat: cat || "other", title: "", text: "", enabled: true };
    return { cat: x.cat, title: x.title || "", text: x.text || "", enabled: !!x.enabled };
  });
  const textBox = useRef(null);
  const up = (k) => (e) => setG({ ...g, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const useTemplate = ([title, text]) => {
    setG({ ...g, title, text });
    textBox.current.focus();
  };
  const save = async () => {
    const r = await api("/api/guidance", { op: "save", item: { id: id || undefined, cat: g.cat, title: g.title, text: g.text, enabled: g.enabled } });
    setS({ guidance: r.guidance });
    closeModal();
    toast("Guidance saved. Try it in the Test panel.");
  };
  return (
    <Modal
      title={id ? "Edit guidance" : "New guidance"}
      footer={
        <>
          <button className="btn" value="close">
            Cancel
          </button>
          <Btn className="btn pri" onClick={save}>
            Save guidance
          </Btn>
        </>
      }
    >
      <label className="fl" htmlFor="gc">
        Group
      </label>
      <select className="in" id="gc" value={g.cat} onChange={up("cat")}>
        {Object.entries(cats).map(([k, c]) => (
          <option key={k} value={k}>
            {c.label}
          </option>
        ))}
      </select>
      {id ? null : (
        <>
          <p className="meta" style={{ marginTop: 12 }}>
            Templates, click one to fill in, then edit as you like:
          </p>
          <div className="tpl" id="gtpl">
            {(TEMPLATES[g.cat] || []).map((t) => (
              <button type="button" key={t[0]} onClick={() => useTemplate(t)}>
                + {t[0]}
              </button>
            ))}
          </div>
        </>
      )}
      <label className="fl" htmlFor="gt">
        Short name <span className="muted">(helps the team find it; the bot doesn't read it)</span>
      </label>
      <input className="in" id="gt" value={g.title} onChange={up("title")} maxLength={80} placeholder="For example: Don't promise release dates" />
      <label className="fl" htmlFor="gx">
        What the bot should do
      </label>
      <textarea className="in" id="gx" ref={textBox} rows={5} maxLength={3000} value={g.text} onChange={up("text")} placeholder="Write it as: if the customer asks X, do Y." />
      <label className="chk">
        <input type="checkbox" id="ge" checked={g.enabled} onChange={up("enabled")} /> The bot follows this guidance
      </label>
    </Modal>
  );
}

const openGuidance = (id, cat) => openModal(<GuidanceDialog id={id || null} cat={cat} />, { focus: id ? "#gx" : "#gt" });

export default function Guidance() {
  const { S } = useStore();
  const cats = S.meta.guidanceCats;
  const langName = /^auto$/i.test(S.settings.language) ? "the customer's language" : S.settings.language;
  const toggle = async (g) => {
    const r = await api("/api/guidance", { op: "save", item: { ...g, enabled: !g.enabled } });
    setS({ guidance: r.guidance });
    toast(g.enabled ? "Guidance turned off" : "Guidance turned on");
  };
  const del = async (g) => {
    if (!(await confirmBox("Delete guidance?", `"${g.title || g.text.slice(0, 60)}" will be deleted.`))) return;
    const r = await api("/api/guidance", { op: "delete", id: g.id });
    setS({ guidance: r.guidance });
    toast("Guidance deleted");
  };
  const row = (g) => (
    <div className="row" key={g.id}>
      <Switch on={g.enabled} label="The bot follows this guidance" onClick={() => toggle(g)} />
      <div className="grow">
        <button type="button" className="lk t" onClick={() => openGuidance(g.id)}>
          {g.title || g.text.split("\n")[0].slice(0, 80)}
        </button>
        {g.title ? <p className="sub clamp">{g.text}</p> : null}
        <p className="meta">
          Edited {ago(g.upd)}
          {g.by ? ` by ${g.by}` : ""}
        </p>
      </div>
      <div className="acts">
        <button type="button" className="btn ghost sm danger" onClick={act(() => del(g))}>
          Delete
        </button>
      </div>
    </div>
  );
  return (
    <>
      <Header title="Guidance" desc={`Tell the bot how to talk and how to handle situations, one idea per item. English or Vietnamese both work; the bot still replies to customers in ${langName}.`} />
      {Object.entries(cats).map(([k, c]) => {
        const items = S.guidance.filter((g) => g.cat === k);
        return (
          <section className="sec" key={k}>
            <div className="sec-h">
              <h2>{c.label}</h2>
              <button type="button" className="btn sm" onClick={() => openGuidance(null, k)}>
                Add
              </button>
            </div>
            <p className="hint">{c.hint}</p>
            <div className="rows">
              {items.length ? (
                items.map(row)
              ) : (
                <div className="empty">
                  No guidance yet.{" "}
                  <button type="button" className="lk" onClick={() => openGuidance(null, k)}>
                    Start from a template
                  </button>
                </div>
              )}
            </div>
          </section>
        );
      })}
      <section className="sec">
        <h2>Fixed rules</h2>
        <p className="hint">The bot always keeps these few rules; guidance above can't override them. Everything else about how it talks and when it hands off is yours to edit: Writing style, Escalation, Feedback &amp; follow-up.</p>
        <div className="rows">
          {FIXED.map((t) => (
            <div className="row" key={t}>
              <span className="st ok" aria-hidden="true">
                ✓
              </span>
              <div className="grow">{t}</div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
