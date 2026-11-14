// Tags: the issue tags the AI picks for each conversation, when to tag, status segment names.
import { Fragment, useState } from "react";
import { Btn, Header, Modal, Switch, act, closeModal, confirmBox, openModal } from "../components/ui.jsx";
import { api } from "../lib/api.js";
import { plural } from "../lib/format.js";
import { useAnalytics } from "../lib/hooks.js";
import { setS, useStore } from "../lib/store.js";
import { toast } from "../lib/toast.js";

async function saveTags(body, msg) {
  const r = await api("/api/tags", body);
  setS({ tags: r.tags });
  toast(msg);
  return r.tags;
}

function TagDialog({ tagKey }) {
  const { S } = useStore();
  const [t, setT] = useState(() => {
    const x = S.tags.items.find((it) => it.key === tagKey) || { key: "", label: "", desc: "", enabled: true };
    return { key: "", label: x.label || "", desc: x.desc || "", enabled: !!x.enabled };
  });
  const up = (k) => (e) => setT({ ...t, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const save = async () => {
    await saveTags({ op: "save", item: { key: tagKey || t.key, label: t.label, desc: t.desc, enabled: t.enabled } }, "Tag saved. The bot uses it from the next conversation.");
    closeModal();
  };
  return (
    <Modal
      title={tagKey ? `Edit tag ${S.tags.prefix}${tagKey}` : "Add tag"}
      footer={
        <>
          <button className="btn" value="close">
            Cancel
          </button>
          <Btn className="btn pri" onClick={save}>
            Save tag
          </Btn>
        </>
      }
    >
      {tagKey ? null : (
        <>
          <label className="fl" htmlFor="tk">
            Tag key
          </label>
          <input className="in" id="tk" value={t.key} onChange={up("key")} maxLength={30} placeholder="for example: shipping-app" autoComplete="off" />
          <p className="meta">
            Lowercase letters, numbers, - or _. In Crisp it shows as{" "}
            <b id="tkx">
              {S.tags.prefix}
              {t.key.trim().toLowerCase() || "…"}
            </b>
            . The key can't be changed after you create it.
          </p>
        </>
      )}
      <label className="fl" htmlFor="tl">
        Name
      </label>
      <input className="in" id="tl" value={t.label} onChange={up("label")} maxLength={60} placeholder="For example: Conflict with a shipping app" />
      <label className="fl" htmlFor="td">
        Use when
      </label>
      <textarea className="in" id="td" rows={4} maxLength={400} value={t.desc} onChange={up("desc")} placeholder="Describe when a conversation belongs to this tag, with example questions if you like. The AI reads this to pick the tag." />
      <label className="chk">
        <input type="checkbox" id="te" checked={t.enabled} onChange={up("enabled")} disabled={tagKey === "other"} /> The bot uses this tag
      </label>
    </Modal>
  );
}

const openTag = (key) => openModal(<TagDialog tagKey={key || null} />, { focus: key ? "#tl" : "#tk" });

const SEGMENTS = [
  ["sgh", "handoff", "Bot handed off to the team"],
  ["sgu", "urgent", "Urgent: angry customer or a serious problem"],
  ["sg1", "p1", "Priority P1 (critical)"],
  ["sg2", "p2", "Priority P2 (high)"],
  ["sgp", "paused", "Team joined, bot stays quiet"],
];
const draftOf = (T) => ({ timing: T.timing, prefix: T.prefix, segments: { ...T.segments } });

export default function Tags() {
  const { S } = useStore();
  const { data: a, done } = useAnalytics(S.month, { quiet: true });
  const T = S.tags;
  const [d, setD] = useState(() => draftOf(T)); // "How tagging works", until Save
  const [typed, setTyped] = useState(false);
  const head = <Header title="Tags" desc={'The bot adds one tag to each conversation in Crisp so you can report by topic. The AI reads "Use when" to pick a tag, so the clearer it is, the more accurate the tags.'} />;
  if (!done) {
    return (
      <>
        {head}
        <p className="loading">Loading…</p>
      </>
    );
  }
  const count = (k) => a?.topics.find((t) => t.key === k)?.conv || 0;
  const toggle = (t) => saveTags({ op: "save", item: { ...t, enabled: !t.enabled } }, t.enabled ? "Tag turned off" : "Tag turned on");
  const del = async (k) => {
    if (!(await confirmBox("Delete tag?", `The bot will stop adding ${T.prefix}${k}. Older conversations keep this tag in Crisp.`))) return;
    await saveTags({ op: "delete", key: k }, "Tag deleted");
  };
  const saveSettings = async () => {
    const tags = await saveTags({ op: "settings", timing: d.timing, prefix: d.prefix, segments: d.segments }, "Tagging settings saved");
    setD(draftOf(tags));
    setTyped(false);
  };
  const timing = (v, title, text) => (
    <label className="radio">
      <input type="radio" name="timing" value={v} checked={d.timing === v} onChange={() => setD({ ...d, timing: v })} />
      <div>
        <b>{title}</b>
        <span>{text}</span>
      </div>
    </label>
  );
  return (
    <>
      {head}
      <section className="sec">
        <div className="sec-h">
          <h2>
            Tag list{" "}
            <span className="cnt">
              {T.items.length}/{S.meta.maxTags}
            </span>
          </h2>
          <button type="button" className="btn sm pri" onClick={() => openTag(null)}>
            Add tag
          </button>
        </div>
        <div className="rows">
          {T.items.map((t) => (
            <div className="row" key={t.key}>
              <Switch on={t.enabled} label="Tag is on" disabled={t.key === "other"} onClick={() => toggle(t)} />
              <div className="grow">
                <p className="t">
                  <button type="button" className="lk" onClick={() => openTag(t.key)}>
                    {t.label}
                  </button>{" "}
                  <span className="chip c-tag">{T.prefix + t.key}</span>
                </p>
                <p className="sub clamp">Use when: {t.desc}</p>
                <p className="meta">
                  {plural(count(t.key), "conversation")} this month{t.key === "other" ? ", the default tag, so it's always on" : ""}
                </p>
              </div>
              <div className="acts">
                {t.key === "other" ? null : (
                  <button type="button" className="btn ghost sm danger" onClick={act(() => del(t.key))}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="sec">
        <h2>How tagging works</h2>
        <div className="form">
          <div className="fr">
            <div className="lb">When to tag</div>
            <div className="radios">
              {timing("first", "On the bot's first reply", "The team sees the tag as soon as they pick up the chat. Conversations the team handles alone are tagged when resolved.")}
              {timing("resolve", "When the conversation is resolved", "The AI reads the whole conversation before choosing, so it's more accurate, but there's no tag while the chat is live.")}
            </div>
          </div>
          <div className="fr">
            <label htmlFor="tp">
              Prefix<small>Goes before the tag key in Crisp</small>
            </label>
            <div>
              <input
                className="in"
                id="tp"
                value={d.prefix}
                onChange={(e) => {
                  setD({ ...d, prefix: e.target.value });
                  setTyped(true);
                }}
                maxLength={20}
                style={{ maxWidth: 220 }}
              />
              <p className="meta" id="tpx">
                Example: {typed ? d.prefix.trim().toLowerCase() : d.prefix}setup
              </p>
            </div>
          </div>
          <div className="fr">
            <div className="lb">
              Status segments<small>The bot adds these to conversations</small>
            </div>
            <div>
              {SEGMENTS.map(([id, k, label]) => (
                <Fragment key={id}>
                  <label className="fl" htmlFor={id} style={{ marginTop: 0 }}>
                    {label}
                  </label>
                  <input className="in" id={id} value={d.segments[k]} onChange={(e) => setD({ ...d, segments: { ...d.segments, [k]: e.target.value } })} maxLength={40} style={{ marginBottom: 12 }} />
                </Fragment>
              ))}
            </div>
          </div>
        </div>
        <div className="savebar">
          <p className="meta">If you change the prefix or a segment name, older conversations keep the old name in Crisp.</p>
          <Btn className="btn pri" onClick={saveSettings}>
            Save tagging settings
          </Btn>
        </div>
      </section>
    </>
  );
}
