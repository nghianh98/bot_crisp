// State of the "Test the bot" panel: a multi-turn chat that uses the saved knowledge. Drawn by components/Preview.jsx.
import { useSyncExternalStore } from "react";
import { api } from "./api.js";

let P = {
  msgs: [], // { role: "user" | "assistant" | "error", content, text?, images?, meta?, q?, note?, fbDone? }
  att: [], // screenshots attached to the question being typed: [{ name, src (data URL) }]
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
export const pvReset = () => put({ msgs: [], att: [], hand: false, focus: P.focus + 1 });

export const MAX_ATTACH = 3;
const MAX_SIDE = 1600; // px: enough to read a screenshot, small enough to send quickly

/** Attach image files (picked or pasted) to the question being typed. They are shrunk in the browser first. */
export async function pvAttach(files) {
  for (const file of files) {
    if (P.att.length >= MAX_ATTACH) throw new Error(`Up to ${MAX_ATTACH} images per message.`);
    let bmp;
    try {
      bmp = await createImageBitmap(file);
    } catch {
      throw new Error("Couldn't read that image. Use a PNG or JPG screenshot.");
    }
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * k));
    canvas.height = Math.max(1, Math.round(bmp.height * k));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; // JPEG has no transparency
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    put({ att: [...P.att, { name: file.name || "screenshot.png", src: canvas.toDataURL("image/jpeg", 0.85) }] });
  }
}
export const pvDetach = (i) => put({ att: P.att.filter((_, k) => k !== i) });

/** "key: value" lines from the Customer data box → { key: value } */
export function customerData(text = P.cust) {
  const out = {};
  for (const line of String(text || "").split("\n")) {
    const i = line.indexOf(":");
    if (i > 0 && line.slice(i + 1).trim()) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/** Send a test question. With images: the same shape a real customer's screenshot has in the chat. */
export async function pvAsk(text, att = []) {
  text = String(text || "").trim();
  if ((!text && !att.length) || P.busy) return;
  const files = att.map((a) => `[sent a file: ${a.name}]`).join("\n");
  const mine = att.length ? { role: "user", content: [text, files].filter(Boolean).join("\n"), text, images: att.map((a) => a.src) } : { role: "user", content: text };
  put({ open: true, focus: P.focus + 1, msgs: [...P.msgs, mine], busy: true });
  let reply;
  let handoff = false;
  try {
    const history = P.msgs.filter((m) => m.role === "user" || m.role === "assistant").map((m) => (m.images ? { role: m.role, content: m.content, images: m.images } : { role: m.role, content: m.content }));
    const r = await api("/api/test", { messages: history, handedOff: P.hand, customer: customerData(), snippetMode: P.snip || undefined });
    reply = { role: "assistant", content: r.reply, meta: r, q: text || mine.content };
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
