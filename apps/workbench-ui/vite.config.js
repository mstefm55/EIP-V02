import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  envDir: "../..",
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:4010",
        changeOrigin: true,
      },
    },
  },
});
