// Loading per-month data for a page.
import { useEffect, useState } from "react";
import { loadAn, loadLog, useStore } from "./store.js";
import { fail } from "./toast.js";

/**
 * Numbers of one month. → { data, done }: done turns true when loading finished, even if it failed
 * (quiet: a failure isn't shown; the page draws without numbers).
 */
export function useAnalytics(month, { quiet = false } = {}) {
  const { an } = useStore();
  const [failed, setFailed] = useState(null);
  useEffect(() => {
    let live = true;
    loadAn(month).catch((e) => {
      if (!live) return;
      setFailed(month);
      if (!quiet) fail(e);
    });
    return () => {
      live = false;
    };
  }, [month]);
  return { data: an[month] || null, done: !!an[month] || failed === month };
}

/** Bot replies logged in one month (oldest first), or null while loading */
export function useLog(month) {
  const { log } = useStore();
  useEffect(() => {
    loadLog(month).catch(fail);
  }, [month]);
  return log[month] || null;
}
