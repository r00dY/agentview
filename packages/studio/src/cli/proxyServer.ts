import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

export const PROXY_PORT = 19890;

// Headers we should not forward when proxying — either computed by the
// transport layer or specific to the incoming connection.
const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "content-length", // Let Node recompute
  "x-target-url", // Our directive header, should not leak
]);

function filterHeaders(
  headers: http.IncomingHttpHeaders,
): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (HOP_BY_HOP.has(key.toLowerCase())) continue;
    out[key] = value;
  }
  return out;
}

function sendError(res: http.ServerResponse, args: { statusCode: number, code: string, url?: string, message: string }) {
  if (res.headersSent) {
    try { res.end(); } catch {}
    return;
  }
  const { statusCode, ...body } = args;
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify({source: "agentview", ...body}));
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const targetUrlRaw = req.headers["x-target-url"];
  const targetUrl = Array.isArray(targetUrlRaw) ? targetUrlRaw[0] : targetUrlRaw;

  if (!targetUrl) {
    sendError(res, { statusCode: 400, code: "LOCAL_PROXY_ERROR", message: "Missing X-Target-Url header" });
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    sendError(res, { statusCode: 400, code: "LOCAL_PROXY_ERROR", message: `Invalid X-Target-Url: ${targetUrl}` });
    return;
  }

  const requester = parsed.protocol === "https:" ? https : http;

  const upstreamReq = requester.request(
    {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: req.method,
      headers: filterHeaders(req.headers),
    },
    (upstreamRes) => {
      // Pipe status + headers + body (works for SSE because no buffering / encoding transform)
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
      upstreamRes.on("error", () => {
        try { res.end(); } catch {}
      });
    },
  );

  upstreamReq.on("error", (err) => {
    // console.log('error', err)
    // console.log('error message', (err as Error).message)
    const code = (err as any).code ?? "UNKNOWN_ERROR";
    sendError(res, { statusCode: 502, code, message: `Local server unreachable.`, url: targetUrl });
  });

  // If the client disconnects before the response is fully sent, abort the
  // upstream request.  We listen on `res` (the outgoing response) rather than
  // `req` (the incoming request) because `req.on("close")` fires as soon as
  // the request body is fully consumed – which may be well before the upstream
  // has had a chance to respond.
  res.on("close", () => {
    if (!res.writableFinished && !upstreamReq.destroyed) upstreamReq.destroy();
  });

  req.pipe(upstreamReq);
}

export interface ProxyServer {
  port: number;
  close: () => Promise<void>;
}

export function startProxyServer(port: number = PROXY_PORT): Promise<ProxyServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handleRequest);

    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve({
        port,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}
