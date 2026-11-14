// @ts-nocheck  (JavaScript thuần: tắt phần kiểm tra kiểu TypeScript của trình sửa code Cloudflare)
// Giao diện trang /admin.
//
// Mã nguồn giao diện (React) nằm ở thư mục admin-ui/ ngoài src/. Lệnh `npm run build` (Vite) gói nó thành file tĩnh
// trong build/admin/, và wrangler đưa thư mục build/ lên Cloudflare cùng lúc với Worker (mục "assets" trong wrangler.jsonc).
// Worker đọc các file đó qua binding ASSETS. Mọi request vẫn đi qua Worker trước (run_worker_first),
// nên chỉ người đã đăng nhập mới tải được giao diện.
import { hash } from "../util.js";

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

const NOT_BUILT = "The admin page isn't built yet. Run `npm run build`, then deploy again.";

const indexHtml = (env, origin) => (env.ASSETS ? env.ASSETS.fetch(new Request(`${origin}/admin/index.html`)) : null);

/** Trang /admin: file index.html do Vite tạo ra, kèm các header bảo mật */
export async function adminPage(env, url) {
  const res = await indexHtml(env, url.origin);
  if (!res?.ok) return new Response(NOT_BUILT, { status: 500 });
  return new Response(res.body, { headers: PAGE_HEADERS });
}

/** File giao diện: /admin/assets/<tên>-<mã nội dung>.js|css. Tên file đổi mỗi khi nội dung đổi, nên trình duyệt giữ được lâu. */
export async function uiFile(env, request) {
  if (!env.ASSETS) return new Response(NOT_BUILT, { status: 500 });
  const res = await env.ASSETS.fetch(request);
  if (res.status !== 200 && res.status !== 304) return new Response("Not found", { status: 404 });
  const headers = new Headers(res.headers);
  headers.set("cache-control", "private, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");
  return new Response(res.body, { status: res.status, headers });
}

/** Mã phiên bản giao diện (hiện ở trang /status): hash của index.html, đổi sau mỗi lần deploy có sửa giao diện */
export async function uiVersion(env, origin) {
  const res = await indexHtml(env, origin).catch(() => null);
  return res?.ok ? hash(await res.text()) : "not built";
}
