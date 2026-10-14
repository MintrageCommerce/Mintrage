// Mintrage Worker entry point.
// /api/* runs the backend. Everything else is served from the static files (the website).
import { onRequest } from "./functions/api/[[path]].js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return onRequest({ request, env, waitUntil: (p) => ctx.waitUntil(p) });
    }
    return env.ASSETS.fetch(request);
  },
};
