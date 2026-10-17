// WebSocket transport for the hub: one /ws endpoint, wired manually onto
// the HTTP server's 'upgrade' event by BOTH entries (prod serve() and the
// dev httpServer that also hosts vite's HMR socket).
//
// Deliberately not Hono's upgradeWebSocket helper: it plugs into adaptor
// internals that getRequestListener — which dev.ts uses to stack vite in
// front of Hono — does not expose. Owning the upgrade ourselves keeps dev
// and prod byte-identical in behaviour. Coexistence with vite HMR is safe:
// vite's upgrade listener only claims connections carrying its own
// subprotocol, and we only claim /ws.

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";

import type { Hub } from "./hub.ts";

/** The minimal surface wirePanelSocket needs — accepts @hono/node-server's
 *  ServerType union without pulling http2 typings in here. */
interface UpgradeServer {
  on(
    event: "upgrade",
    listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void,
  ): unknown;
  listenerCount(event: "upgrade"): number;
}

export function wirePanelSocket(server: UpgradeServer, hub: Hub): void {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  server.on("upgrade", (req, socket: Duplex, head: Buffer) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path !== "/ws") {
      // Not ours. Destroy only when nobody else could legitimately take it
      // (prod has no other upgrade listener; dev leaves it to vite's).
      if (server.listenerCount("upgrade") === 1) socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const conn = hub.attach((msg) => ws.send(JSON.stringify(msg)));
      ws.on("message", (raw) => conn.message(raw.toString()));
      ws.on("close", () => conn.close());
      ws.on("error", () => {
        try {
          ws.close();
        } catch {
          // already gone — the close handler did the detach
        }
      });
    });
  });
}
