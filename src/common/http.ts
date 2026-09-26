import type { IncomingMessage, ServerResponse } from "node:http";

export function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks: Buffer[] = [];
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      req.removeAllListeners("data");
      req.removeAllListeners("end");
      req.removeAllListeners("error");
      req.removeAllListeners("close");
      fn();
    };
    req.on("data", (c: Buffer) => {
      bytes += c.length;
      if (bytes > 1_000_000) {
        req.destroy();
        done(() => reject(new Error("too large")));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      done(() => {
        const s = Buffer.concat(chunks).toString("utf8");
        if (!s) return resolve({});
        try {
          resolve(JSON.parse(s));
        } catch {
          reject(new Error("bad json"));
        }
      });
    });
    req.on("error", (e) => done(() => reject(e)));
    req.on("close", () => done(() => reject(new Error("connection closed"))));
  });
}

export function send(res: ServerResponse, code: number, body: unknown) {
  if (res.headersSent) return;
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

/** Full HTML-escape for values interpolated into innerHTML (quotes alone are not enough). */
export function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
