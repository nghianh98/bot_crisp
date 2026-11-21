// One shared state for the whole admin. Components read it with useStore() and redraw when it changes.
import { useSyncExternalStore } from "react";
import { api } from "./api.js";

let state = {
  S: null, // data from /api/state
  stateAt: 0, // when S was last read in full (Overview reads it again after a minute)
  an: {}, // analytics per month, loaded when a page needs it
  log: {}, // bot replies per month
  models: null, // OpenAI models for Settings: null = not loaded, { loading }, { list }, { error }
  syncing: false, // this tab is running "Sync now"
  // Choices made in the interface, kept while moving between pages
  ui: { tab: "snippets", q: "", exq: "", cf: "all", cq: "", month: null, groups: {} },
};
const subs = new Set();
const subscribe = (f) => {
  subs.add(f);
  return () => subs.delete(f);
};

export const get = () => state;
export function set(patch) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  subs.forEach((f) => f());
}
export const useStore = () => useSyncExternalStore(subscribe, get);

/** Merge a server answer ({ settings }, { kb }, …) into S */
export const setS = (patch) => set((s) => ({ S: { ...s.S, ...patch } }));
export const setUI = (patch) => set((s) => ({ ui: { ...s.ui, ...patch } }));

export async function loadAn(month) {
  if (!state.an[month]) {
    const a = await api(`/api/analytics?month=${month}`);
    set((s) => ({ an: { ...s.an, [month]: a } }));
  }
  return state.an[month];
}
export async function loadLog(month) {
  if (!state.log[month]) {
    const items = (await api(`/api/log?month=${month}`)).items;
    set((s) => ({ log: { ...s.log, [month]: items } }));
  }
  return state.log[month];
}

/** The month shown on Performance, Conversations and Suggestions */
export const shownMonth = (s = state) => s.ui.month || s.S.month;

export const tagFull = (k) => (state.S.tags.prefix || "") + k;
export const tagLabel = (k) => state.S.tags.items.find((t) => t.key === k)?.label || k;
