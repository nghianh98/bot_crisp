// @ts-nocheck  (JavaScript thuần: tắt phần kiểm tra kiểu TypeScript của trình sửa code Cloudflare)
// Đăng nhập trang quản trị bằng ADMIN_KEY (lưu trong cookie).
import { loginPage } from "./pages.js";
import { clip, hash } from "../util.js";

export const COOKIE = "tb_admin";

export const WHO_COOKIE = "tb_who";

export const adminToken = async (env) => (await hash(`tb-admin:${env.ADMIN_KEY}`)) + (await hash(`${env.ADMIN_KEY}:tb-admin`));

export const readCookie = (request, name) => {
  const c = (request.headers.get("cookie") || "").split(/;\s*/).find((x) => x.startsWith(name + "="));
  return c ? c.slice(name.length + 1) : null;
};

export async function isAdmin(env, request) {
  if (!env.ADMIN_KEY) return false;
  return readCookie(request, COOKIE) === (await adminToken(env));
}

const COOKIE_OPTS = `Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`;

async function signedIn(env, location, name) {
  const headers = new Headers({ Location: location });
  headers.append("Set-Cookie", `${COOKIE}=${await adminToken(env)}; ${COOKIE_OPTS}`);
  if (name !== undefined) headers.append("Set-Cookie", `${WHO_COOKIE}=${encodeURIComponent(name || "Admin")}; ${COOKIE_OPTS}`);
  return new Response(null, { status: 303, headers });
}

/** Link cũ dạng /admin?key=...: đổi sang cookie rồi bỏ key khỏi đường dẫn */
export function keyLogin(env, url) {
  if (env.ADMIN_KEY && url.searchParams.get("key") === env.ADMIN_KEY) return signedIn(env, url.origin + "/admin");
  return loginPage(env, "/admin");
}

export function whoOf(request) {
  try {
    return clip(decodeURIComponent(readCookie(request, WHO_COOKIE) || ""), 40) || "Admin";
  } catch {
    return "Admin";
  }
}

export async function login(env, url, request) {
  const form = await request.formData();
  const next = String(form.get("next") || "/admin");
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/admin";
  const name = clip(form.get("name"), 40);
  if (!env.ADMIN_KEY || form.get("key") !== env.ADMIN_KEY) return loginPage(env, safeNext, "Wrong password.", name);
  return signedIn(env, url.origin + safeNext, name);
}

export function logout(url) {
  const headers = new Headers({ Location: url.origin + "/admin" });
  for (const c of [COOKIE, WHO_COOKIE]) headers.append("Set-Cookie", `${c}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  return new Response(null, { status: 303, headers });
}
