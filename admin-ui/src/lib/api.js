// Calls to the Worker's /api. A body makes it a POST.
import { toast } from "./toast.js";

export async function api(path, body) {
  const opt = body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  const res = await fetch(path, opt);
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (res.status === 401) {
    // `npm run dev:ui` has no sign-in page of its own: the cookie comes from the Worker's /admin
    if (import.meta.env.DEV) throw new Error("Not signed in. Open the Worker's own /admin (npm run dev, usually http://localhost:8787/admin), sign in there, then reload this page.");
    toast("Your session has expired. Opening the sign-in page…", { err: true });
    setTimeout(() => location.reload(), 1500);
    throw new Error(data.error || "Session expired");
  }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}
