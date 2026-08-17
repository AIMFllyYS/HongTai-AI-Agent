import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

import { hongtaiBrowserIo } from "./vite-hongtai-browser-io";

export default defineConfig({
  plugins: [react(), hongtaiBrowserIo()],
  build: {
    target: "chrome89",
  },
  server: {
    host: "127.0.0.1",
  },
  preview: {
    host: "127.0.0.1",
  },
});
