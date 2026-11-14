// State of the "Test the bot" panel: a multi-turn chat that uses the saved knowledge. Drawn by components/Preview.jsx.
import { useSyncExternalStore } from "react";
import { api } from "./api.js";

let P = {
  msgs: [], // { role: "user" | "assistant" | "error", content, meta?, q?, note?, fbDone? }
  busy: false,
  open: false,
  hand: false, // "Pretend the conversation was already handed off"
  snip: "", // try snippets "knowledge" / "exact", or "" = as saved
  cust: "", // customer data, one "key: value" per line
  focus: 0, // bumped to put the cursor in the question box
};
const subs = new Set();
const put = (patch) => {
  P = { ...P, ...patch };
  subs.forEach((f) => f());
};
export const usePreview = () =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => P
  );
export const setPreview = put;

export const pvOpen = () => put({ open: true, focus: P.focus + 1 });
export const pvClose = () => put({ open: false });
export const pvReset = () => put({ msgs: [], hand: false, focus: P.focus + 1 });

/** "key: value" lines from the Customer data box → { key: value } */
export function customerData(text = P.cust) {
  const out = {};
  for (const line of String(text || "").split("\n")) {
    const i = line.indexOf(":");
    if (i > 0 && line.slice(i + 1).trim()) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

export async function pvAsk(text) {
  text = String(text || "").trim();
  if (!text || P.busy) return;
  put({ open: true, focus: P.focus + 1, msgs: [...P.msgs, { role: "user", content: text }], busy: true });
  let reply;
  let handoff = false;
  try {
    const history = P.msgs.filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({ role: m.role, content: m.content }));
    const r = await api("/api/test", { messages: history, handedOff: P.hand, customer: customerData(), snippetMode: P.snip || undefined });
    reply = { role: "assistant", content: r.reply, meta: r, q: text };
    handoff = r.action === "handoff"; // from here on the test conversation counts as handed off
  } catch (e) {
    reply = { role: "error", content: `Couldn't test: ${e.message}` };
  }
  put({ msgs: [...P.msgs, reply], busy: false, ...(handoff ? { hand: true } : {}) });
}

/** The customer clicked one of the two feedback buttons under reply number i */
export function pvFeedback(i, v) {
  const m = P.msgs[i];
  const msgs = P.msgs.map((x, k) => (k === i ? { ...x, fbDone: true } : x));
  if (v === "yes") {
    put({ msgs: [...msgs, { role: "user", content: m.meta.feedback.yes }, { role: "assistant", content: m.meta.feedback.thanks, note: "Recorded: the customer confirmed it's solved." }] });
  } else {
    put({ msgs });
    pvAsk(m.meta.feedback.no);
  }
}
