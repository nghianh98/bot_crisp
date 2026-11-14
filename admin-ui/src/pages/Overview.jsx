// Overview: how the bot is doing, this month's numbers, to-dos, connections, latest replies.
import { Chips, Fig } from '../components/common.jsx';
import { Header } from '../components/ui.jsx';
import { fmtClock, fmtDay, fmtTime, monthLabel, n, pct, plural, tzLabel } from '../lib/format.js';
import { useAnalytics } from '../lib/hooks.js';
import { useStore } from '../lib/store.js';

const MODE_SENTENCE = {
	off: 'The bot is off: only your team answers customers.',
	offline: 'The bot answers when nobody on the team is online in Crisp.',
	always: 'The bot answers every message, even when the team is online. !!!',
};

function statusSentence(S) {
	const s = S.settings;
	return `${MODE_SENTENCE[s.mode]} ${s.businessHours ? `Team working hours: ${s.businessHours} (${tzLabel(S.meta.utcOffset)}).` : "Working hours aren't set."}`;
}

function todos(S, a) {
	const t = [];
	for (const h of S.health.filter((x) => !x.ok)) t.push(['bad', `${h.label} isn't ready`, h.fix]);
	if (S.settings.product === 'our product' || !S.settings.productDesc)
		t.push([
			'todo',
			"The product isn't described yet",
			'Add the product name and a short description so the bot knows what it supports.',
			'#settings',
			'Open settings',
		]);
	if (S.settings.mode === 'off')
		t.push(['todo', 'The bot is off', 'Pick another mode in Bot mode on the left when you want the bot to answer customers.']);
	if (S.pending)
		t.push([
			'todo',
			`${plural(S.pending, 'question')} the bot couldn't answer`,
			'Add snippets so the bot can answer them next time.',
			'#suggestions',
			'See suggestions',
		]);
	if (a?.feedback.down)
		t.push([
			'todo',
			`${plural(a.feedback.down, 'customer')} rated an answer not helpful`,
			'Review what the bot told them.',
			'#conversations?down',
			'See conversations',
		]);
	if (!S.snippets.length)
		t.push(['todo', 'No snippets yet', "Add answers to common questions the help center doesn't cover.", '#content', 'Add a snippet']);
	if (!S.settings.supportEmail)
		t.push([
			'todo',
			"Support email isn't set",
			'The bot offers this email when it hands off outside working hours.',
			'#settings',
			'Open settings',
		]);
	if (!S.settings.businessHours)
		t.push([
			'todo',
			"Working hours aren't set",
			'The bot uses them to tell customers when the team will reply.',
			'#settings',
			'Open settings',
		]);
	return t;
}

function Status({ kind, mark }) {
	return (
		<span className={`st ${kind}`} aria-hidden="true">
			{mark}
		</span>
	);
}

export default function Overview() {
	const { S } = useStore();
	const { data: a, done } = useAnalytics(S.month, { quiet: true });
	const head = <Header title="Overview" desc={statusSentence(S)} />;
	if (!done) {
		return (
			<>
				{head}
				<p className="loading">Loading numbers…</p>
			</>
		);
	}
	const todo = todos(S, a);
	return (
		<>
			{head}
			<section className="sec">
				<div className="sec-h">
					<h2>{monthLabel(S.month)}</h2>
					<a href="#performance">See performance</a>
				</div>
				<div className="figs">
					<Fig value={n(a?.customers)} label="conversations" />
					<Fig value={pct(a?.involved, a?.customers)} label="with the bot involved" sub={plural(a?.involved || 0, 'conversation')} />
					<Fig value={pct(a?.resolved, a?.involved)} label="resolved by the bot" sub={`${n(a?.resolved)} without a handoff`} />
					<Fig
						value={n(S.pending)}
						label="questions without an answer"
						sub={S.pending ? <a href="#suggestions">See suggestions</a> : 'all handled'}
					/>
				</div>
			</section>
			<section className="sec">
				<h2>To do</h2>
				<div className="rows">
					{todo.length ? (
						todo.map(([kind, title, sub, href, label]) => (
							<div className="row" key={title}>
								<Status kind={kind} mark="!" />
								<div className="grow">
									<p className="t">{title}</p>
									<p className="sub">{sub}</p>
								</div>
								{href ? (
									<div className="acts">
										<a className="btn sm" href={href}>
											{label}
										</a>
									</div>
								) : null}
							</div>
						))
					) : (
						<div className="row">
							<Status kind="ok" mark="✓" />
							<div className="grow">
								<p className="t">Nothing to do</p>
								<p className="sub">The bot is running well. Check Suggestions once a week.</p>
							</div>
						</div>
					)}
				</div>
			</section>
			<section className="sec">
				<h2>Connections</h2>
				<div className="rows">
					{S.health.map((h) => (
						<div className="row" key={h.label}>
							<Status kind={h.ok ? 'ok' : 'bad'} mark={h.ok ? '✓' : '!'} />
							<div className="grow">
								<p className="t">{h.label}</p>
								<p className="sub">{h.ok ? h.detail || 'Ready' : h.fix}</p>
							</div>
						</div>
					))}
					<div className="row">
						<Status kind={S.lastReply ? 'ok' : 'todo'} mark={S.lastReply ? '✓' : '!'} />
						<div className="grow">
							<p className="t">Latest bot reply</p>
							<p className="sub">
								{S.lastReply ? fmtTime(S.lastReply) : 'None this month yet'}
								{S.queued ? `. ${plural(S.queued, 'conversation')} waiting for a follow-up.` : ''}
							</p>
						</div>
					</div>
				</div>
			</section>
			<section className="sec">
				<div className="sec-h">
					<h2>Latest bot replies</h2>
					<a href="#conversations">See all</a>
				</div>
				<div className="rows">
					{S.recent.length ? (
						S.recent.map((x, i) => (
							<div className="row conv" key={x.id || i}>
								<div className="when">
									<b>{fmtDay(x.t)}</b>
									{fmtClock(x.t)}
								</div>
								<div className="grow">
									<p className="qtxt">{x.q}</p>
									<div className="chips">
										<Chips x={x} />
									</div>
								</div>
							</div>
						))
					) : (
						<div className="empty">The bot hasn't replied to anyone this month yet.</div>
					)}
				</div>
			</section>
		</>
	);
}
