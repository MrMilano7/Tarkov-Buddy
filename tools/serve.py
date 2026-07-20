#!/usr/bin/env python3
"""
serve.py — the Tarkov Companion dev server. Use this instead of
`python -m http.server`.

Usage (from the project root):
    python tools/serve.py          # serves on port 8080
    python tools/serve.py 9000     # or any other port

Why this exists: plain http.server negotiates caching with the browser
using file timestamps. Zip archives can carry timestamps "from the
future" relative to the device clock, which makes the browser cache
stale copies of data and code and the server keep answering
"304 Not Modified" — the app then ignores importer updates and hotfixes
entirely. This server sends Cache-Control: no-store and never answers
304, so the browser always gets what is actually on disk.
"""
import http.server
import socket
import os
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()

    def send_head(self):
        # Drop conditional request headers so we never reply 304 —
        # every response carries the real current file content.
        for header in ("If-Modified-Since", "If-None-Match"):
            if header in self.headers:
                del self.headers[header]
        return super().send_head()


socketserver.TCPServer.allow_reuse_address = True


class DualStackServer(socketserver.ThreadingTCPServer):
    """Bind IPv6 AND IPv4 on one socket (v0.9.6).

    On Android, `localhost` resolves to ::1 first. The old server bound
    IPv4 only, so anything squatting on the IPv6 side (e.g. a forgotten
    plain `python -m http.server`) would silently answer localhost
    requests with 304s and stale files while this server sat unused on
    127.0.0.1. Dual-stack binding closes that hole: both addresses are
    always ours, and a squatter makes startup fail loudly with
    "Address already in use" instead of hijacking traffic.
    """
    address_family = socket.AF_INET6
    daemon_threads = True

    def server_bind(self):
        try:
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        except (AttributeError, OSError):
            pass  # dual-stack unsupported: IPv6-only is still fine
        super().server_bind()


try:
    server = DualStackServer(("::", PORT), NoCacheHandler)
    bound = "IPv4 + IPv6 (localhost and 127.0.0.1 both safe)"
except OSError as e:
    if getattr(e, "errno", None) == 98:  # EADDRINUSE — name the culprit
        print(f"Port {PORT} is already taken by another process!")
        print("Find and kill it first:  ps -ef | grep -i python")
        sys.exit(1)
    server = socketserver.TCPServer(("", PORT), NoCacheHandler)
    bound = "IPv4 only — use http://127.0.0.1 in the browser"

with server as httpd:
    print(f"Tarkov Buddy serving at http://localhost:{PORT}  [{bound}]")
    print("Browser caching disabled — every reload gets fresh files. CTRL+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
