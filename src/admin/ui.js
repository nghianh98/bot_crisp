// @ts-nocheck  (JavaScript thuần: tắt phần kiểm tra kiểu TypeScript của trình sửa code Cloudflare)
// Giao diện trang /admin.
//
// Các file trong admin-ui/ là code chạy trên TRÌNH DUYỆT (HTML, CSS, JS), không phải code của Worker.
// Cloudflare chỉ nhận 3 loại file: .js (code chạy trên máy chủ), .txt và .html (văn bản).
// Vì vậy file CSS và JS của giao diện có thêm đuôi .txt: Worker đọc chúng như văn bản
// rồi gửi nguyên văn cho trình duyệt. Không có bước build hay gộp file nào.
//
// Thêm 1 file giao diện mới: tạo file trong admin-ui/ (ví dụ pages/abc.js.txt),
// rồi thêm 1 dòng import và 1 dòng trong FILES bên dưới.
import INDEX from "../admin-ui/index.html";
import styles from "../admin-ui/styles.css.txt";
import main from "../admin-ui/main.js.txt";
import core from "../admin-ui/core.js.txt";
import components from "../admin-ui/components.js.txt";
import preview from "../admin-ui/preview.js.txt";
import overview from "../admin-ui/pages/overview.js.txt";
import content from "../admin-ui/pages/content.js.txt";
import guidance from "../admin-ui/pages/guidance.js.txt";
import tags from "../admin-ui/pages/tags.js.txt";
import escalation from "../admin-ui/pages/escalation.js.txt";
import followup from "../admin-ui/pages/followup.js.txt";
import performance from "../admin-ui/pages/performance.js.txt";
import conversations from "../admin-ui/pages/conversations.js.txt";
import suggestions from "../admin-ui/pages/suggestions.js.txt";
import settings from "../admin-ui/pages/settings.js.txt";
import { hash } from "../util.js";

// Tên file trình duyệt gọi (không có đuôi .txt) → nội dung file
const FILES = {
  "styles.css": styles,
  "main.js": main,
  "core.js": core,
  "components.js": components,
  "preview.js": preview,
  "pages/overview.js": overview,
  "pages/content.js": content,
  "pages/guidance.js": guidance,
  "pages/tags.js": tags,
  "pages/escalation.js": escalation,
  "pages/followup.js": followup,
  "pages/performance.js": performance,
  "pages/conversations.js": conversations,
  "pages/suggestions.js": suggestions,
  "pages/settings.js": settings,
};

const TYPES = { css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8" };

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

// Mã phiên bản giao diện = hash nội dung mọi file giao diện. Mã nằm trong đường dẫn (/admin/ui/<mã>/...):
// trình duyệt giữ file trong bộ nhớ đệm, và tự tải bản mới ngay sau lần deploy có sửa giao diện.
let version;
export const uiVersion = () => (version ??= hash(INDEX + Object.entries(FILES).map(([name, text]) => `\n${name}\n${text}`).join("")));

/** Trang /admin: index.html, với {{ui}} thay bằng đường dẫn tới các file giao diện */
export async function adminPage() {
  const base = `/admin/ui/${await uiVersion()}`;
  return new Response(INDEX.replaceAll("{{ui}}", base), { headers: PAGE_HEADERS });
}

/** File giao diện: /admin/ui/<mã phiên bản>/<tên file> */
export async function uiFile(pathname) {
  const [v, ...rest] = pathname.slice("/admin/ui/".length).split("/");
  const name = rest.join("/");
  if (!Object.hasOwn(FILES, name)) return new Response("Not found", { status: 404 });
  const current = v === (await uiVersion());
  return new Response(FILES[name], {
    headers: {
      "content-type": TYPES[name.slice(name.lastIndexOf(".") + 1)],
      "cache-control": current ? "private, max-age=31536000, immutable" : "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
