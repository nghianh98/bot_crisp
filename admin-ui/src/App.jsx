// The frame of the admin: load the data once, sidebar, the page chosen by #name in the address, the Test panel.
import { useEffect, useRef, useState } from "react";
import { Tip } from "./components/common.jsx";
import Preview, { botInitial } from "./components/Preview.jsx";
import { ModalHost, Toast } from "./components/ui.jsx";
import { api } from "./lib/api.js";
import { pvClose, pvOpen, usePreview } from "./lib/preview.js";
import { set, setS, useStore } from "./lib/store.js";
import { fail, toast } from "./lib/toast.js";
import Content from "./pages/Content.jsx";
import Conversations from "./pages/Conversations.jsx";
import Escalation from "./pages/Escalation.jsx";
import Followup from "./pages/Followup.jsx";
import Guidance from "./pages/Guidance.jsx";
import Overview from "./pages/Overview.jsx";
import Performance from "./pages/Performance.jsx";
import Settings, { Changelog } from "./pages/Settings.jsx";
import Style from "./pages/Style.jsx";
import Suggestions from "./pages/Suggestions.jsx";
import Tags from "./pages/Tags.jsx";

// Add a page: write pages/Name.jsx, add it here, and add its link in NAV below.
const PAGES = {
  overview: Overview,
  content: Content,
  guidance: Guidance,
  style: Style,
  tags: Tags,
  escalation: Escalation,
  followup: Followup,
  performance: Performance,
  conversations: Conversations,
  suggestions: Suggestions,
  settings: Settings,
  changelog: Changelog,
};
const NAV = [
  ["overview", "Overview"],
  "Train",
  ["content", "Knowledge"],
  ["guidance", "Guidance"],
  ["style", "Writing style"],
  ["tags", "Tags"],
  ["escalation", "Escalation"],
  ["followup", "Feedback & follow-up"],
  "Analyze",
  ["performance", "Performance"],
  ["conversations", "Conversations"],
  ["suggestions", "Suggestions"],
  "System",
  ["settings", "Settings"],
  ["changelog", "Change log"],
];
// Train pages keep the Test panel docked beside the editor on wide screens
const TRAIN = new Set(["content", "guidance", "style", "tags", "escalation", "followup"]);
const MODES = [
  ["off", "Off"],
  ["offline", "When team is offline"],
  ["always", "Always on"],
];
const MODE_NOTE = { off: "The bot is off", offline: "Replies when the team is offline", always: "Replies to every message" };
const WIDE = "(min-width: 1280px)";

/** "#conversations?down" → { name: "conversations", arg: "down" } */
function readHash() {
  const [name, arg] = (location.hash.slice(1) || "overview").split("?");
  return { name: PAGES[name] ? name : "overview", arg: arg || null };
}

function Sidebar({ page, open }) {
  const { S } = useStore();
  const s = S?.settings;
  const [picked, setPicked] = useState(null); // the mode just chosen, while it is being saved
  const changeMode = async (e) => {
    const v = e.target.value;
    const label = e.target.selectedOptions[0].textContent;
    setPicked(v);
    try {
      setS(await api("/api/settings", { settings: { mode: v } }));
      toast(`Bot mode: ${label}`);
    } catch (err) {
      fail(err);
    }
    setPicked(null);
  };
  return (
    <aside className={`side${open ? " open" : ""}`} id="side" aria-label="Menu">
      <div className="brand">
        <span className="mark" aria-hidden="true">
          {botInitial(S)}
        </span>
        <div>
          <b id="botName">{s ? s.botName : "Support Bot"}</b>
          <small>Admin</small>
        </div>
      </div>

      <div className="mode">
        <label htmlFor="modeSel">
          <span className={`dot${s?.mode === "off" ? " off" : ""}`} id="modeDot" />
          <span id="modeNote">{s ? MODE_NOTE[s.mode] : "Bot mode"}</span>
        </label>
        <select id="modeSel" aria-label="Bot mode" value={picked ?? s?.mode ?? "off"} onChange={changeMode} disabled={!s}>
          {MODES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>

      <nav id="nav">
        {NAV.map((x) =>
          typeof x === "string" ? (
            <p className="ng" key={x}>
              {x}
            </p>
          ) : (
            <a href={`#${x[0]}`} key={x[0]} aria-current={S && page === x[0] ? "page" : undefined}>
              {x[1]}
              {x[0] === "suggestions" ? (
                <>
                  {" "}
                  <span className="badge" id="nPending" hidden={!S?.pending}>
                    {S ? (S.pending > 99 ? "99+" : S.pending) : null}
                  </span>
                </>
              ) : null}
            </a>
          )
        )}
      </nav>

      <div className="me">
        <span id="who">{S?.who}</span>
        <a href="/logout">Sign out</a>
      </div>
    </aside>
  );
}

function useWide() {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches);
  useEffect(() => {
    const mq = window.matchMedia(WIDE);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

export default function App() {
  const { S } = useStore();
  const P = usePreview();
  const [route, setRoute] = useState(readHash);
  const [side, setSide] = useState(false); // sidebar opened on a narrow screen
  const [error, setError] = useState(null);
  const main = useRef(null);
  const wide = useWide();

  useEffect(() => {
    api("/api/state")
      .then((data) => set((s) => ({ S: data, stateAt: Date.now(), ui: { ...s.ui, month: data.month } })))
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    const go = () => setRoute(readHash());
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, []);
  // A new page starts at the top, with the menu closed
  useEffect(() => {
    if (!S) return;
    setSide(false);
    window.scrollTo(0, 0);
    main.current?.focus({ preventScroll: true });
  }, [route, !S]);

  useEffect(() => {
    if (S) document.title = `${S.settings.botName} Admin`;
  }, [S?.settings.botName]);

  const closeOverlays = () => {
    setSide(false);
    pvClose();
  };
  useEffect(() => {
    const key = (e) => {
      if (e.key === "Escape" && !document.getElementById("dlg").open) closeOverlays();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);

  const dock = !!S && TRAIN.has(route.name);
  const docked = dock && wide; // the Test panel sits beside the page instead of sliding over it
  const Page = PAGES[route.name];
  const initial = botInitial(S);

  return (
    <>
      <header className="topbar">
        <button className="btn ghost" type="button" aria-label="Open menu" onClick={() => setSide(true)}>
          ☰
        </button>
        <span className="mark" aria-hidden="true">
          {initial}
        </span>
        <b className="top-name">{S ? S.settings.botName : "Support Bot"}</b>
      </header>

      <div className={`app${dock ? " dock" : ""}`} id="app">
        <Sidebar page={route.name} open={side} />
        <main className="main" id="main" tabIndex={-1} ref={main}>
          {S ? (
            <div className="wrap">
              <Page arg={route.arg} />
            </div>
          ) : error ? (
            <div className="wrap">
              <header className="ph">
                <div>
                  <h1>Couldn't load the admin</h1>
                  <p>{error}</p>
                </div>
              </header>
              <p>
                <a className="btn" href="/admin">
                  Reload
                </a>
              </p>
            </div>
          ) : null}
        </main>
        <Preview />
      </div>

      <button className="fab" id="fab" type="button" onClick={pvOpen}>
        <span className="av" aria-hidden="true">
          {initial}
        </span>
        Test the bot
      </button>
      <div className={`scrim${(P.open && !docked) || side ? " on" : ""}`} id="scrim" onClick={closeOverlays} />
      <ModalHost />
      <Toast />
      <Tip />
    </>
  );
}
