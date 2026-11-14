// @ts-nocheck  (JavaScript thuần: tắt phần kiểm tra kiểu TypeScript của trình sửa code Cloudflare)
/**
 * Support Bot — AI chatbot hỗ trợ khách trên Crisp (hiện dùng cho Transtore; sản phẩm, help center điền trên /admin → Settings).
 * Chạy trên Cloudflare Workers, dùng OpenAI. Kiến thức: help center + trang website + snippet do team viết.
 *
 * Trang quản trị: /admin (đăng nhập bằng ADMIN_KEY)
 *   Huấn luyện: kiến thức, hướng dẫn, văn phong, chuyển người, hỏi ý kiến & nhắc khách
 *   Phân tích: hiệu suất, hội thoại, gợi ý cải thiện
 *   Cài đặt: sản phẩm, help center, chế độ, giờ làm việc, email, khoá OpenAI + model, sao lưu, nhật ký thay đổi
 *
 * Cloudflare → Worker → Settings → Variables and Secrets (nên để kiểu Secret):
 *   CRISP_IDENTIFIER, CRISP_KEY, CRISP_HOOK_SECRET, ADMIN_KEY (OPENAI_API_KEY: tuỳ chọn, nhập khoá trên /admin cũng được)
 * Bindings: KV namespace tên KB.   Triggers → Cron: * * * * *
 *
 * Code chia nhiều file, không gộp: mỗi file ở đây là 1 file trên Cloudflare (Edit code → Explorer).
 *   worker.js      cổng vào (file này)
 *   bot.js, ai.js, followup.js, knowledge.js, ...   phần bot
 *   admin/         API và đăng nhập của trang quản trị
 *   admin-ui/      giao diện trang quản trị chạy trên trình duyệt (xem admin/ui.js)
 */

import { api } from "./admin/api.js";
import { isAdmin, keyLogin, login, logout } from "./admin/auth.js";
import { loginPage, statusPage } from "./admin/pages.js";
import { adminPage, uiFile } from "./admin/ui.js";
import { handleEvent } from "./bot.js";
import { cfg, withConfig } from "./config.js";
import { verifySignature } from "./crisp.js";
import { processFollowups } from "./followup.js";
import { cronSync } from "./knowledge.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;

    if (request.method === "POST" && p === "/crisp/hooks") return onHook(request, env, ctx);
    if (p === "/login" && request.method === "POST") return login(env, url, request);
    if (p === "/logout") return logout(url);
    if (p === "/admin" || p === "/admin/") {
      if (url.searchParams.has("key")) return keyLogin(env, url);
      if (!(await isAdmin(env, request))) return loginPage(env, "/admin");
      return adminPage();
    }
    if (p.startsWith("/admin/ui/")) {
      if (!(await isAdmin(env, request))) return new Response("Sign in at /admin first", { status: 401 });
      return uiFile(p);
    }
    if (p.startsWith("/api/")) return api(env, request, url);
    if (p === "/report") return Response.redirect(`${url.origin}/admin#performance`, 302);
    if (p === "/settings") return Response.redirect(`${url.origin}/admin#content`, 302);
    if (p === "/" || p === "/status") return statusPage(await withConfig(env));
    return new Response("Not found", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    // Mỗi phút: tiếp tục / bắt đầu đồng bộ kiến thức khi tới hạn, và gửi lời nhắc khách tới hạn. Lúc rảnh chỉ tốn 2 lần đọc KV.
    ctx.waitUntil(cronSync(env).catch((e) => console.error("[kb] Lỗi:", e?.stack || e)));
    ctx.waitUntil(processFollowups(env).catch((e) => console.error("[followup] Lỗi:", e?.stack || e)));
  },
};

export async function onHook(request, env, ctx) {
  const raw = await request.text();
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (cfg(env, "VERIFY_HOOKS") !== "false") {
    const ok = await verifySignature(env.CRISP_HOOK_SECRET || "", raw, body, request.headers.get("x-crisp-request-timestamp"), request.headers.get("x-crisp-signature"));
    if (!ok) {
      // Không ghi secret hay chữ ký ra log; chỉ ghi đủ để biết lỗi nằm ở đâu
      console.warn("[hook] Sai chữ ký, bỏ qua", body?.event, `(CRISP_HOOK_SECRET ${env.CRISP_HOOK_SECRET ? "có" : "THIẾU"}, có header chữ ký: ${!!request.headers.get("x-crisp-signature")})`);
      return new Response("ok");
    }
  }
  // Trả lời Crisp ngay, xử lý ở nền (tối đa 30 giây)
  ctx.waitUntil(withConfig(env).then((e) => handleEvent(body, e)).catch((e) => console.error("[hook] Lỗi:", e?.stack || e)));
  return new Response("ok");
}
