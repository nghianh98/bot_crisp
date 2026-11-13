// @ts-nocheck  (JavaScript thuần: tắt phần kiểm tra kiểu TypeScript của trình sửa code Cloudflare)
// Trang đăng nhập và trang trạng thái (đường dẫn /).
import { MODE_LABELS, cfg, currentMode } from "../config.js";
import { parseBusinessHours } from "../time.js";
import { esc, getJSON } from "../util.js";
import { uiVersion } from "./ui.js";

export const PAGE_CSS = `*{box-sizing:border-box}body{margin:0;font:15px/1.55 "Be Vietnam Pro",system-ui,sans-serif;color:#16213a;background:#f4f5f8}
.wrap{max-width:720px;margin:48px auto;padding:0 16px}h1{font-size:24px;margin:0 0 6px}h2{font-size:16px;margin:28px 0 8px}
table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #e3e6ee;border-radius:10px;overflow:hidden}td{padding:10px 14px;border-bottom:1px solid #eef0f4}
tr:last-child td{border-bottom:0}.muted{color:#6b7591}a{color:#2a5be8}code{background:#eef0f4;padding:1px 5px;border-radius:4px}
.login{max-width:380px;margin:12vh auto;padding:32px;background:#fff;border:1px solid #e3e6ee;border-radius:14px}
.mark{width:36px;height:36px;border-radius:10px;background:#f0661e;display:grid;place-items:center;color:#fff;font-weight:700;margin-bottom:16px}
label{display:block;font-size:13px;font-weight:600;margin:16px 0 6px}input{width:100%;padding:11px 12px;border:1px solid #cfd4df;border-radius:8px;font:inherit}
input:focus{outline:2px solid #2a5be8;outline-offset:1px;border-color:#2a5be8}button{margin-top:20px;width:100%;padding:12px;border:0;border-radius:8px;background:#2a5be8;color:#fff;font:600 15px "Be Vietnam Pro",system-ui,sans-serif;cursor:pointer}
.err{color:#c62f2f;margin:12px 0 0}`;

export const FONT_LINK = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&display=swap">`;

export const html = (title, body) =>
  new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>${FONT_LINK}<style>${PAGE_CSS}</style><body>${body}</body></html>`, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY" },
  });

export const loginPage = (env, next, error = "", name = "") =>
  html(
    "Sign in",
    `<form class="login" method="post" action="/login"><div class="mark">T</div><h1>${esc(cfg(env, "BOT_NAME"))}</h1><p class="muted" style="margin:0">Bot admin</p>
${env.ADMIN_KEY ? "" : `<p class="err">The admin is not set up yet: add a Secret named <code>ADMIN_KEY</code> in Cloudflare.</p>`}
<input type="hidden" name="next" value="${esc(next)}">
<label for="name">Your name</label><input id="name" name="name" value="${esc(name)}" placeholder="For example: Linh" autocomplete="nickname" maxlength="40">
<label for="key">Password</label><input id="key" name="key" type="password" autocomplete="current-password" ${name ? "autofocus" : ""}>
${error ? `<p class="err">${esc(error)}</p>` : ""}<button>Sign in</button>
<p class="muted" style="font-size:13px;margin:16px 0 0">Your name is shown in the change log.</p></form>`
  );

export async function statusPage(env) {
  const checks = [
    ["CRISP_IDENTIFIER", !!env.CRISP_IDENTIFIER],
    ["CRISP_KEY", !!env.CRISP_KEY],
    ["CRISP_HOOK_SECRET", !!env.CRISP_HOOK_SECRET || cfg(env, "VERIFY_HOOKS") === "false"],
    ["OPENAI_API_KEY", !!env.OPENAI_API_KEY],
    ["KV binding KB", !!env.KB],
    ["ADMIN_KEY", !!env.ADMIN_KEY],
  ];
  const meta = (await getJSON(env, "kb:meta")) || {};
  const bh = cfg(env, "BUSINESS_HOURS");
  const row = (k, v) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`;
  return html(
    cfg(env, "BOT_NAME"),
    `<div class="wrap"><h1>${esc(cfg(env, "BOT_NAME"))} is running</h1><p class="muted">Manage the bot in the <a href="/admin">admin</a>. Crisp webhook: <code>/crisp/hooks</code></p>
<h2>Configuration</h2><table>${checks.map(([k, ok]) => row(k, ok ? "✓ OK" : "✗ Missing")).join("")}</table>
<h2>Bot</h2><table>
${row("Help center", meta.pages ? `${meta.pages}/${meta.total ?? meta.urls} articles <span class="muted">(built ${esc(meta.builtAt)})</span>` : "Not loaded yet. Wait a few minutes after turning on the Cron trigger.")}
${row("Mode", esc(MODE_LABELS[currentMode(env)]))}
${row("Working hours", bh ? (parseBusinessHours(bh) ? `<code>${esc(bh)}</code>` : `✗ Invalid format: <code>${esc(bh)}</code>`) : "Not set")}
${row("Model", `<code>${esc(cfg(env, "OPENAI_MODEL"))}</code>`)}
${row("Admin UI version", `<code>${await uiVersion()}</code>`)}</table></div>`
  );
}
