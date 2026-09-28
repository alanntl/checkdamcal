#!/usr/bin/env python3
"""Serve CheckDamCal on http://localhost:5288 with browser caching turned off.

Plain `python3 -m http.server` sends no Cache-Control header, so browsers cache
the ES modules heuristically and a reload can keep running an old copy of a
file you just edited. This adds `Cache-Control: no-store` to every response.

    python3 serve.py            # port 5288
    python3 serve.py 8080       # another port
"""

import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".woff2": "font/woff2",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5288
    root = os.path.dirname(os.path.abspath(__file__))
    handler = functools.partial(NoCacheHandler, directory=root)
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"CheckDamCal on http://localhost:{port}  (Ctrl+C to stop)", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
