// WebSocket endpoint resolution.
//
// Vite is configured with `server.host = true`, so the dev server answers on
// every interface and the page can legitimately be opened as
// http://localhost:5173, http://127.0.0.1:5173 or http://<lan-ip>:5173.
//
// Hard-coding 127.0.0.1 for the simulation WebSocket (as V1.0 did) breaks the
// last case: the browser would try to reach the simulation server on *its own*
// loopback, the connection is refused, and the UI shows a permanent
// "Disconnected" even though the backend is running fine on the host. The
// observable symptom is "the page opens but nothing connects".
//
// Deriving the host from the page origin fixes that with no configuration:
// whichever name/address reached the UI also reaches the backend, which
// listens on INADDR_ANY. The host field in the header still overrides it.
export const DEFAULT_WS_PORT = 18098;

export function defaultWsHost(): string {
  if (typeof window === "undefined") return "127.0.0.1";
  const h = window.location.hostname;
  return h && h.length > 0 ? h : "127.0.0.1";
}

export function defaultWsPort(): number {
  if (typeof window === "undefined") return DEFAULT_WS_PORT;
  // ?wsport=NNNNN points the page at a private simulation server instead of the
  // default 18098. The headless UI harness needs this: without it the test
  // silently attaches to whatever server already owns 18098 - typically the one
  // the developer launched with start.bat - and then asserts against *that*
  // session's bus voltage and gains, which produces failures that look like
  // regressions but are really an environment collision.
  const raw = new URLSearchParams(window.location.search).get("wsport");
  if (raw !== null) {
    const q = Number(raw);
    if (Number.isInteger(q) && q > 0 && q < 65536) return q;
  }
  return DEFAULT_WS_PORT;
}
