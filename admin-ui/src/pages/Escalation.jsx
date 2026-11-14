// Escalation: when to hand off to the team, what to ask first, how to rate priority, what the bot does while the customer waits.
// Everything here is the team's own wording: the code only supplies neutral starting text.
import { useRef, useState } from "react";
import { Btn, Header, Switch } from "../components/ui.jsx";
import { api } from "../lib/api.js";
import { pick } from "../lib/format.js";
import { setS, useStore } from "../lib/store.js";
import { toast } from "../lib/toast.js";

const RESET_HOURS = [0, 1, 2, 4, 8, 12, 24, 48];
const COOLDOWN_MIN = [1, 2, 5, 10, 30];
const PLACEHOLDER = {
  fields: "For example: the account email, the order number, the page where it happens",
  custom: "For example: the customer wants to change the account owner",
};

let rowSeq = 0;
// A list line on screen: uid only identifies the row while editing, it is never saved
const lineOf = (x) => ({ uid: ++rowSeq, id: x.id || "", text: x.text || "", enabled: x.enabled !== false });

/** What is saved → what the page edits until Save */
function draftOf(S) {
  const E = S.escalation;
  const D = S.meta.defaults;
  return {
    triggers: { ...E.triggers },
    custom: E.custom.map(lineOf),
    askInfo: !!E.askInfo,
    fields: E.fields.map(lineOf),
    priority: { ...E.priority },
    urgent: E.urgent,
    upset: E.upset ?? D.upset,
    note: !!E.note,
    noteLang: E.noteLang,
    noteExtra: E.noteExtra,
    cooldownMin: pick(COOLDOWN_MIN, E.cooldownMin),
    resetHours: E.resetHours,
    waiting: E.waiting ?? D.waiting,
  };
}

export default function Escalation() {
  const { S } = useStore();
  const E = S.escalation;
  const M = S.meta;
  const D = M.defaults;
  const sg = S.tags.segments;
  const [d, setD] = useState(() => draftOf(S));
  const focusNew = useRef(null); // uid of the line just added, to put the cursor in it
  const up = (patch) => setD((cur) => ({ ...cur, ...patch }));
  const hours = RESET_HOURS.includes(E.resetHours) ? RESET_HOURS : [...RESET_HOURS, E.resetHours].sort((a, b) => a - b);

  const addLine = (list) => {
    const max = list === "fields" ? M.maxFields : M.maxCustomReasons;
    if (d[list].length >= max) return toast(`Up to ${max} lines. Delete one first.`, { err: true });
    const line = lineOf({ enabled: true });
    focusNew.current = line.uid;
    up({ [list]: [...d[list], line] });
  };
  const setLine = (list, uid, patch) => up({ [list]: d[list].map((x) => (x.uid === uid ? { ...x, ...patch } : x)) });
  const restore = (k) => {
    if (k === "priority") up({ priority: { ...D.priority }, urgent: D.urgent });
    else up({ [k]: D[k] });
    toast("Default text filled in. Click Save to apply.");
  };
  const save = async () => {
    const lines = (list) => d[list].map((x) => ({ id: x.id || undefined, text: x.text, enabled: x.enabled }));
    const escalation = {
      triggers: Object.fromEntries(Object.keys(M.triggers).map((k) => [k, !!d.triggers[k]])),
      custom: lines("custom"),
      askInfo: d.askInfo,
      fields: lines("fields"),
      cooldownMin: d.cooldownMin,
      resetHours: d.resetHours,
      note: d.note,
      noteLang: d.noteLang,
      noteExtra: d.noteExtra,
      priority: Object.fromEntries(Object.keys(M.priorityLevels).map((k) => [k, d.priority[k]])),
      urgent: d.urgent,
      upset: d.upset,
      waiting: d.waiting,
    };
    const r = await api("/api/settings", { escalation });
    setS(r);
    setD(draftOf({ ...S, ...r }));
    toast("Escalation settings saved");
  };

  // One editable line of a list (details to ask for, the team's own hand-off reasons)
  const lineRows = (list, empty) =>
    d[list].length ? (
      d[list].map((x) => (
        <div className="row li" key={x.uid}>
          <Switch on={x.enabled} label="Use this line" onClick={() => setLine(list, x.uid, { enabled: !x.enabled })} />
          <div className="grow">
            <input
              className="in"
              value={x.text}
              onChange={(e) => setLine(list, x.uid, { text: e.target.value })}
              maxLength={300}
              placeholder={PLACEHOLDER[list]}
              aria-label={PLACEHOLDER[list]}
              ref={(el) => {
                if (el && focusNew.current === x.uid) {
                  focusNew.current = null;
                  el.focus();
                }
              }}
            />
          </div>
          <div className="acts">
            <button type="button" className="btn ghost sm danger" onClick={() => up({ [list]: d[list].filter((y) => y.uid !== x.uid) })}>
              Delete
            </button>
          </div>
        </div>
      ))
    ) : (
      <div className="empty">{empty}</div>
    );
  const restoreLink = (k) => (
    <button type="button" className="lk" onClick={() => restore(k)}>
      Restore default
    </button>
  );

  return (
    <>
      <Header title="Escalation" desc="Choose when the bot hands a conversation to the team, what it asks first, and how it behaves around a handoff. All wording on this page is yours to edit. Click Save to apply." />
      <section className="sec">
        <h2>The bot hands off when</h2>
        <div className="rows">
          {Object.entries(M.triggers).map(([k, t]) => (
            <div className="row" key={k}>
              <Switch on={d.triggers[k]} label={t.label} onClick={() => up({ triggers: { ...d.triggers, [k]: !d.triggers[k] } })} />
              <div className="grow">
                <p className="t">{t.label}</p>
                <p className="sub">{t.hint}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="sec-h" style={{ marginTop: 18 }}>
          <h3 className="h3">Your own reasons</h3>
          <button type="button" className="btn sm" onClick={() => addLine("custom")}>
            Add a reason
          </button>
        </div>
        <p className="hint">Situations in your product that always need a person. Write each one as a short phrase.</p>
        <div className="rows" id="list-custom">
          {lineRows("custom", "No reasons of your own yet.")}
        </div>
        <p className="note">With everything in this section off, the bot never hands off and always answers itself. The team can still reply in any conversation at any time.</p>
      </section>

      <section className="sec">
        <h2>Ask for details before handing off</h2>
        <div className="rows">
          <div className="row">
            <Switch on={d.askInfo} label="Ask for details before handing off" onClick={() => up({ askInfo: !d.askInfo })} />
            <div className="grow">
              <p className="t">Ask the customer once before handing off</p>
              <p className="sub">The bot asks for any missing details in one message, then hands off. It never asks for something your app already sends to Crisp. If the customer asks for a person, is angry or has a payment dispute, it hands off right away.</p>
            </div>
          </div>
        </div>
        <div className="sec-h" style={{ marginTop: 18 }}>
          <h3 className="h3">Details to ask for</h3>
          <button type="button" className="btn sm" onClick={() => addLine("fields")}>
            Add a detail
          </button>
        </div>
        <p className="hint">What your team needs to start working on a case. Write each one the way the bot should ask for it. Never list passwords or card numbers.</p>
        <div className="rows" id="list-fields">
          {lineRows("fields", "No details listed: the bot hands off without asking.")}
        </div>
      </section>

      <section className="sec">
        <div className="sec-h">
          <h2>Priority and urgency</h2>
          {restoreLink("priority")}
        </div>
        <p className="hint">
          The bot rates every conversation P1–P4 with your definitions. P1 always goes to a person right away; P1 and P2 get the <b>{sg.p1}</b> and <b>{sg.p2}</b> segments in Crisp.
        </p>
        <div className="form">
          {Object.entries(M.priorityLevels).map(([k, name]) => (
            <div className="fr" key={k}>
              <label htmlFor={`pr_${k}`}>{name}</label>
              <textarea className="in" id={`pr_${k}`} rows={2} maxLength={400} value={d.priority[k]} onChange={(e) => up({ priority: { ...d.priority, [k]: e.target.value } })} />
            </div>
          ))}
          <div className="fr">
            <label htmlFor="urg">
              Urgent
              <small>
                Adds the <b>{sg.urgent}</b> segment. Finish the sentence "urgent when…"
              </small>
            </label>
            <textarea className="in" id="urg" rows={2} maxLength={400} value={d.urgent} onChange={(e) => up({ urgent: e.target.value })} />
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="sec-h">
          <h2>Upset customers</h2>
          {restoreLink("upset")}
        </div>
        <p className="hint">How the bot talks to a customer who is angry or upset, one rule per line. Leave empty for no special rules.</p>
        <textarea className="in" id="upset" rows={7} maxLength={M.maxRuleChars} spellCheck={false} value={d.upset} onChange={(e) => up({ upset: e.target.value })} />
      </section>

      <section className="sec">
        <h2>Note for the team</h2>
        <div className="rows">
          <div className="row">
            <Switch on={d.note} label="Leave a note for the team" onClick={() => up({ note: !d.note })} />
            <div className="grow">
              <p className="t">Leave a private note when handing off</p>
              <p className="sub">The bot adds a short brief to the conversation in Crisp: why it needs a person, what the customer needs, the details they gave, what's still missing and what to do first. Only the team sees it, never the customer. Try it in Test the bot.</p>
            </div>
          </div>
        </div>
        <div className="form" style={{ marginTop: 12 }}>
          <div className="fr">
            <label htmlFor="nl">Written in</label>
            <input className="in" id="nl" maxLength={30} value={d.noteLang} onChange={(e) => up({ noteLang: e.target.value })} placeholder="English" />
          </div>
          <div className="fr">
            <label htmlFor="nx">
              What the note should include<small>Optional. Anything your team always wants to see.</small>
            </label>
            <textarea className="in" id="nx" rows={3} maxLength={600} value={d.noteExtra} onChange={(e) => up({ noteExtra: e.target.value })} placeholder="For example: always include the customer's plan and the page where the problem happens." />
          </div>
        </div>
      </section>

      <section className="sec">
        <h2>While the customer waits for the team</h2>
        <div className="rows">
          <div className="row">
            <div className="grow">
              <p className="t">The customer keeps messaging</p>
              <p className="sub">
                Until someone on the team replies, the bot keeps answering, at most one message every{" "}
                <select className="in inl" id="cd" aria-label="Minutes between bot messages after a handoff" value={d.cooldownMin} onChange={(e) => up({ cooldownMin: +e.target.value })}>
                  {COOLDOWN_MIN.map((v) => (
                    <option key={v} value={v}>
                      {v} min
                    </option>
                  ))}
                </select>
                . Messages sent sooner are answered when that time is up (within about a minute), never skipped.
              </p>
            </div>
          </div>
          <div className="row">
            <div className="grow">
              <p className="t">The customer comes back later</p>
              <p className="sub">
                A customer who writes again after a quiet period of{" "}
                <select className="in inl" id="rh" aria-label="Quiet hours before a new chat" value={d.resetHours} onChange={(e) => up({ resetHours: +e.target.value })}>
                  {hours.map((v) => (
                    <option key={v} value={v}>
                      {v ? `${v} h` : "never"}
                    </option>
                  ))}
                </select>{" "}
                starts a new chat: the bot answers normally and only mentions the earlier case if they ask. The case stays in the team's inbox.
              </p>
            </div>
          </div>
          <div className="row">
            <div className="grow">
              <p className="t">Marked in Crisp</p>
              <p className="sub">
                The conversation gets the <b>{sg.handoff}</b> segment. When someone on the team replies, the bot goes quiet and adds <b>{sg.paused}</b>. Resolving the conversation turns the bot back on. Rename segments on the Tags page.
              </p>
            </div>
          </div>
        </div>
        <div className="sec-h" style={{ marginTop: 18 }}>
          <h3 className="h3">How the bot replies while they wait</h3>
          {restoreLink("waiting")}
        </div>
        <p className="hint">Rules for the bot's replies after a handoff, until the team answers. Leave empty for no special rules.</p>
        <textarea className="in" id="waiting" rows={7} maxLength={M.maxRuleChars} spellCheck={false} value={d.waiting} onChange={(e) => up({ waiting: e.target.value })} />
      </section>
      <div className="savebar">
        <p className="meta">Changes reach real customers within about a minute.</p>
        <Btn className="btn pri" onClick={save}>
          Save
        </Btn>
      </div>
    </>
  );
}
