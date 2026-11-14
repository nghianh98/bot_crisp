// Performance: automation, involvement, resolution and satisfaction rates; funnel; customers per day; topics.
import { DailyChart, Fig, Funnel, MonthNav } from "../components/common.jsx";
import { Header } from "../components/ui.jsx";
import { monthLabel, n, pct } from "../lib/format.js";
import { useAnalytics } from "../lib/hooks.js";
import { shownMonth, tagFull, tagLabel, useStore } from "../lib/store.js";

export default function Performance() {
  const s = useStore();
  const m = shownMonth(s);
  const { data: a } = useAnalytics(m);
  const head = <Header title="Performance" desc="How many customers the bot helped this month, and on which topics." right={<MonthNav />} />;
  if (!a) {
    return (
      <>
        {head}
        <p className="loading">Loading numbers for {monthLabel(m)}…</p>
      </>
    );
  }
  const fbTotal = a.feedback.up + a.feedback.down;
  const maxTopic = Math.max(1, ...a.topics.map((t) => t.conv));
  const outcomes = [
    ["Customer clicked Helpful", a.confirmed],
    ["Bot answered, no further questions", a.assumed],
    ["Handed off to the team", a.handoff],
    ["Customer left when the bot asked for details", a.abandoned],
  ];
  const maxOut = Math.max(1, ...outcomes.map((o) => o[1]));
  const bot = a.bot;
  const days = a.days.filter((d) => d.customers || d.involved);
  const did = [
    ["Answers sent", bot.answers],
    ["Times it asked for details", bot.askInfo],
    ["Handoffs to the team", bot.handoffs],
    ["Angry customers or badly broken stores", bot.urgent],
    ["Questions without knowledge", bot.gaps],
    ["Nudges sent to quiet customers", bot.nudges],
  ];
  return (
    <>
      {head}
      <section className="sec">
        <div className="figs">
          <Fig value={pct(a.resolved, a.customers)} label="Automation rate" sub={`The bot handled ${n(a.resolved)} of ${n(a.customers)} conversations`} />
          <Fig value={pct(a.involved, a.customers)} label="Involvement rate" sub={`The bot replied in ${n(a.involved)} of ${n(a.customers)} conversations`} />
          <Fig value={pct(a.resolved, a.involved)} label="Resolution rate" sub={`${n(a.resolved)} of ${n(a.involved)} conversations with the bot`} />
          <Fig value={pct(a.feedback.up, fbTotal)} label="Rated helpful" sub={fbTotal ? `${n(a.feedback.up)} Helpful, ${n(a.feedback.down)} Not helpful` : "No customer has clicked a button yet"} />
        </div>
        <p className="note">Handled by the bot means the bot replied without handing off, including customers who clicked Helpful and customers who didn't ask anything else. That's why it's worth reading next to the Rated helpful rate.</p>
      </section>

      <section className="sec">
        <h2>Funnel</h2>
        <Funnel
          steps={[
            { label: "All conversations", v: a.customers },
            { label: "Bot involved", v: a.involved },
            { label: "Handled by the bot", v: a.resolved },
            { label: "Customer clicked Helpful", v: a.confirmed },
          ]}
        />
      </section>

      <section className="sec">
        <h2>Customers per day</h2>
        <DailyChart days={a.days} value={(d) => d.customers} tipText={(d) => `Day ${d.d}: ${n(d.customers)} customers\nBot involved ${n(d.involved)}, handed off ${n(d.handoffs)}`} label={`Customers per day in ${monthLabel(m)}`} />
        <details style={{ marginTop: 8 }}>
          <summary className="meta" style={{ cursor: "pointer" }}>
            Show as a table
          </summary>
          <table className="tbl" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Day</th>
                <th className="num">Customers</th>
                <th className="num">Bot involved</th>
                <th className="num">Handed off</th>
              </tr>
            </thead>
            <tbody>
              {days.length ? (
                days.map((d) => (
                  <tr key={d.d}>
                    <td>{d.d}</td>
                    <td className="num">{n(d.customers)}</td>
                    <td className="num">{n(d.involved)}</td>
                    <td className="num">{n(d.handoffs)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="muted">
                    No data yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </details>
      </section>

      <section className="sec">
        <h2>Outcomes of conversations with the bot</h2>
        <table className="tbl">
          <thead>
            <tr>
              <th>Outcome</th>
              <th className="num">Conversations</th>
              <th className="num">Share</th>
              <th className="barcell hide-sm"></th>
            </tr>
          </thead>
          <tbody>
            {outcomes.map(([l, v]) => (
              <tr key={l}>
                <td>{l}</td>
                <td className="num">{n(v)}</td>
                <td className="num">{pct(v, a.involved)}</td>
                <td className="barcell hide-sm">
                  <div className="bar" style={{ width: `${(v / maxOut) * 100}%` }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="sec">
        <div className="sec-h">
          <h2>Topics</h2>
          <a href="#tags">Edit tag list</a>
        </div>
        {a.topics.length ? (
          <>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Tag</th>
                  <th className="num">Conversations</th>
                  <th className="num">Handled by the bot</th>
                  <th className="barcell hide-sm"></th>
                </tr>
              </thead>
              <tbody>
                {a.topics.map((t) => (
                  <tr key={t.key}>
                    <td>
                      <b>{tagLabel(t.key)}</b>
                      <div className="meta">{tagFull(t.key)}</div>
                    </td>
                    <td className="num">{n(t.conv)}</td>
                    <td className="num">{t.bot ? pct(t.resolved, t.bot) : "–"}</td>
                    <td className="barcell hide-sm">
                      <div className="bar" style={{ width: `${(t.conv / maxTopic) * 100}%` }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="note">Handled by the bot per topic counts only conversations the bot took part in. {n(a.classified)} resolved conversations were re-tagged by the AI.</p>
          </>
        ) : (
          <div className="rows">
            <div className="empty">No conversations have been tagged this month.</div>
          </div>
        )}
      </section>

      <section className="sec">
        <h2>What the bot did</h2>
        <table className="tbl">
          <tbody>
            {did.map(([l, v]) => (
              <tr key={l}>
                <td>{l}</td>
                <td className="num">{n(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="note">These counts are approximate: in rare cases two events arriving at once can shift a number by 1 or 2.</p>
      </section>
    </>
  );
}
