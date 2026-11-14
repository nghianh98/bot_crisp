// Feedback & follow-up: Helpful / Not helpful buttons after an answer, nudges when the customer goes quiet, closing the chat.
import { useState } from "react";
import { Btn, Header, Switch } from "../components/ui.jsx";
import { api } from "../lib/api.js";
import { pick } from "../lib/format.js";
import { setS, useStore } from "../lib/store.js";
import { toast } from "../lib/toast.js";

const MIN = [5, 10, 15, 30, 60, 120, 240];
const HOURS = [1, 2, 4, 8, 12, 24, 48, 72];
const hours = (h) => `${h} ${h === 1 ? "hour" : "hours"}`;

// What happens after the bot replies, in order (drawn from what is saved)
function Flow({ F }) {
  const step = (on, em, b, s) => (
    <div className={`fstep${on ? "" : " off"}`}>
      <em>{em}</em>
      <b>{b}</b>
      <span>{s}</span>
    </div>
  );
  return (
    <div className="flow" aria-label="What happens after the bot replies, in order">
      {step(true, "Step 1", "Bot replies", "with a link to the guide")}
      {step(F.feedback, "Right after", "Asks if it helped", `2 buttons: ${F.yesLabel} / ${F.noLabel}`)}
      {step(F.nudge, `Quiet for ${F.nudgeMin} min`, "Nudges once", "only if the customer hasn't replied")}
      {step(F.close, `Quiet for ${hours(F.closeHours)}`, "Closes the chat", F.autoResolve ? "and resolves it in Crisp" : "logged as no reply from the customer")}
    </div>
  );
}

/** What is saved → what the page edits until Save */
const draftOf = (F) => ({ ...F, nudgeMin: pick(MIN, F.nudgeMin), infoNudgeMin: pick(MIN, F.infoNudgeMin), closeHours: pick(HOURS, F.closeHours) });

export default function Followup() {
  const { S } = useStore();
  const F = S.followup;
  const [d, setD] = useState(() => draftOf(F));
  const up = (patch) => setD((cur) => ({ ...cur, ...patch }));
  const flip = (k, label) => <Switch on={d[k]} label={label} onClick={() => up({ [k]: !d[k] })} />;
  const txt = (id, k, max, rows = 2) => <textarea className="in" id={id} rows={rows} maxLength={max} style={{ minHeight: 0 }} value={d[k]} onChange={(e) => up({ [k]: e.target.value })} />;
  const sel = (id, k, list, unit, label) => (
    <select className="in" id={id} aria-label={label} value={d[k]} onChange={(e) => up({ [k]: +e.target.value })}>
      {list.map((x) => (
        <option key={x} value={x}>
          {x} {unit}
        </option>
      ))}
    </select>
  );
  const save = async () => {
    const followup = {
      feedback: d.feedback,
      feedbackText: d.feedbackText,
      yesLabel: d.yesLabel,
      noLabel: d.noLabel,
      thanksText: d.thanksText,
      nudge: d.nudge,
      nudgeMin: d.nudgeMin,
      nudgeText: d.nudgeText,
      infoNudge: d.infoNudge,
      infoNudgeMin: d.infoNudgeMin,
      infoNudgeText: d.infoNudgeText,
      close: d.close,
      closeHours: d.closeHours,
      autoResolve: d.autoResolve,
      fallbackText: d.fallbackText,
    };
    const r = await api("/api/settings", { followup });
    setS(r);
    setD(draftOf(r.followup));
    toast("Feedback and follow-up settings saved");
  };
  return (
    <>
      <Header title="Feedback & follow-up" desc="After the bot replies, ask the customer whether the answer helped, and nudge them when they go quiet. No nudges once the bot has handed off or someone on the team has joined." />
      <section className="sec">
        <Flow F={F} />
      </section>
      <section className="sec">
        <h2>Ask for feedback after an answer</h2>
        <div className="form">
          <div className="fr">
            <div className="lb">
              Send 2 buttons<small>Not sent when the customer is angry or the bot had no answer</small>
            </div>
            <div>{flip("feedback", "Send feedback buttons")}</div>
          </div>
          <div className="fr">
            <label htmlFor="fq">Question</label>
            {txt("fq", "feedbackText", 120, 1)}
          </div>
          <div className="fr">
            <div className="lb">Button text</div>
            <div className="times">
              <input className="in" id="fy" value={d.yesLabel} onChange={(e) => up({ yesLabel: e.target.value })} maxLength={40} aria-label="Helpful button" />
              <input className="in" id="fn" value={d.noLabel} onChange={(e) => up({ noLabel: e.target.value })} maxLength={40} aria-label="Not helpful button" />
            </div>
          </div>
          <div className="fr">
            <label htmlFor="ft">
              Customer clicks helpful<small>The bot thanks them with this message. If they click not helpful, the bot asks what's still not working.</small>
            </label>
            {txt("ft", "thanksText", 300)}
          </div>
        </div>
      </section>
      <section className="sec">
        <h2>Nudge when the customer goes quiet</h2>
        <div className="form">
          <div className="fr">
            <div className="lb">
              After an answer<small>Only nudges once</small>
            </div>
            <div>
              {flip("nudge", "Nudge after an answer")}
              <div className="times">Nudge after {sel("nm", "nudgeMin", MIN, "min", "Minutes")}</div>
              <label className="fl" htmlFor="nt">
                Nudge message
              </label>
              {txt("nt", "nudgeText", 300)}
            </div>
          </div>
          <div className="fr">
            <div className="lb">
              While the bot waits for details<small>For example, it asked for a screenshot and the customer hasn't sent it</small>
            </div>
            <div>
              {flip("infoNudge", "Nudge while waiting for details")}
              <div className="times">Nudge after {sel("im", "infoNudgeMin", MIN, "min", "Minutes")}</div>
              <label className="fl" htmlFor="it">
                Nudge message
              </label>
              {txt("it", "infoNudgeText", 300)}
            </div>
          </div>
        </div>
      </section>
      <section className="sec">
        <h2>Close the chat</h2>
        <div className="form">
          <div className="fr">
            <div className="lb">
              Close when the customer goes quiet<small>Logged in reports as no reply from the customer</small>
            </div>
            <div>
              {flip("close", "Close the chat")}
              <div className="times">
                After {sel("ch", "closeHours", HOURS, "h", "Hours")} from the bot's last reply
              </div>
            </div>
          </div>
          <div className="fr">
            <div className="lb">
              Resolve in Crisp automatically<small>Needs a Production token with write access to website:conversation:states</small>
            </div>
            <div>
              {flip("autoResolve", "Resolve automatically")}
              <p className="meta">If the token only has read access, the bot skips this step and everything else still runs.</p>
            </div>
          </div>
        </div>
      </section>
      <section className="sec">
        <h2>When the AI can't answer</h2>
        <div className="form">
          <div className="fr">
            <label htmlFor="fb">
              Backup message
              <small>
                Sent when the AI fails or is too slow, even after a retry. The conversation is handed to the team.{" "}
                <button type="button" className="lk" onClick={() => up({ fallbackText: S.meta.defaults.fallbackText })}>
                  Restore default
                </button>
              </small>
            </label>
            {txt("fb", "fallbackText", 300)}
          </div>
        </div>
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
