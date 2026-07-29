import { createFileRoute } from "@tanstack/react-router";

/**
 * Proxy server-side hacia ORDS.
 *
 * El navegador llama a `/api/ords/...` (mismo origen) y el servidor reenvía a
 * Oracle. Por eso el front web NO necesita CORS. Además mantiene el token fuera
 * de la URL.
 *
 * La app Expo de `mobile/` no pasa por acá: pega directo a ORDS, que es válido
 * porque el `fetch` de React Native no aplica CORS.
 *
 * Esto exige un deploy CON servidor Node. Si algún día se sirve como sitio
 * estático, este archivo no corre y habría que habilitar CORS en ORDS.
 */

const ORDS_TARGET = process.env.ORDS_TARGET ?? "https://oracleapex.com";
const ORDS_PREFIX = process.env.ORDS_PREFIX ?? "/ords/fundcarac/ethos/";

async function forward(request: Request, splat: string): Promise<Response> {
  const incoming = new URL(request.url);
  const target = `${ORDS_TARGET}${ORDS_PREFIX}${splat}${incoming.search}`;

  const headers = new Headers();
  const auth = request.headers.get("authorization");
  if (auth) headers.set("authorization", auth);
  headers.set("accept", "application/json");
  headers.set("user-agent", "Mozilla/5.0 (ethos-proxy)");

  const init: RequestInit = { method: request.method, headers };
  if (request.method !== "GET" && request.method !== "HEAD") {
    // arrayBuffer y no text(): text() corrompe binarios.
    const body = await request.arrayBuffer();
    // Solo mandar body+content-type si hay payload: un DELETE con content-type
    // JSON y cuerpo vacío hace que ORDS responda 400 ("Expected {,[ but got EOF").
    if (body.byteLength > 0) {
      init.body = body;
      headers.set("content-type", request.headers.get("content-type") ?? "application/json");
    }
  }

  const res = await fetch(target, init);
  const contentType = res.headers.get("content-type") ?? "application/json";
  const body = await res.arrayBuffer();
  const outHeaders: Record<string, string> = { "content-type": contentType };
  const cacheControl = res.headers.get("cache-control");
  if (cacheControl) outHeaders["cache-control"] = cacheControl;
  return new Response(body, { status: res.status, headers: outHeaders });
}

// Los cuatro verbos declarados a propósito: si falta uno, ese método cae al SPA
// y falla en silencio con un 404 de HTML.
export const Route = createFileRoute("/api/ords/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => forward(request, params._splat ?? ""),
      POST: ({ request, params }) => forward(request, params._splat ?? ""),
      PUT: ({ request, params }) => forward(request, params._splat ?? ""),
      DELETE: ({ request, params }) => forward(request, params._splat ?? ""),
    },
  },
});
