// Build của giao diện /admin (React). Mã nguồn: admin-ui/. Kết quả: build/admin/, Worker phục vụ qua binding ASSETS (xem src/admin/ui.js).
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `npm run dev:ui`: giao diện chạy ở cổng 5173 và tự cập nhật khi sửa code; API vẫn do Worker ở máy (npm run dev) trả lời.
const WORKER = process.env.WORKER_URL || "http://localhost:8787";

export default defineConfig({
  root: "admin-ui",
  base: "/admin/",
  plugins: [react()],
  build: { outDir: "../build/admin", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { "/api": WORKER, "/login": WORKER, "/logout": WORKER },
  },
});
