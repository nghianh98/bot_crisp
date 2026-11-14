// The message that slides up at the bottom of the screen. Shown by <Toast /> in components/ui.jsx.
import { useSyncExternalStore } from "react";

let state = { on: false, err: false, msg: "", action: null, onAction: null };
const subs = new Set();
let timer;
const put = (next) => {
  state = next;
  subs.forEach((f) => f());
};

/** opts: { err } for an error, { action, onAction } for a button inside the toast */
export function toast(msg, opts = {}) {
  put({ on: true, err: !!opts.err, msg, action: opts.action || null, onAction: opts.onAction || null });
  clearTimeout(timer);
  timer = setTimeout(hideToast, opts.action ? 8000 : opts.err ? 6000 : 3200);
}
export const hideToast = () => put({ ...state, on: false });
export const fail = (e) => toast(e?.message || String(e), { err: true });
export const useToast = () =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state
  );
