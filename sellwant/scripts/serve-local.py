#!/usr/bin/env python3
"""
Serve the built site on 127.0.0.1 only.

Expo's dev server always binds 0.0.0.0 -- `--host localhost` just changes the
URL it prints -- so it stays reachable from every device on the network. This
binds to loopback, so nothing outside this machine can reach it.

Also resolves extension-less paths (/feed -> feed.html) the way Vercel's
cleanUrls does, and falls back to the route's HTML for deep links.

    bun run serve:local        # from sellwant/
"""
import http.server
import os
import socketserver
import sys

PORT = int(os.environ.get("PORT", "8081"))
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dist")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def translate_path(self, path):
        local = super().translate_path(path)
        if os.path.isdir(local):
            index = os.path.join(local, "index.html")
            if os.path.exists(index):
                return index
        # /feed -> feed.html
        if not os.path.exists(local) and not os.path.splitext(local)[1]:
            html = local + ".html"
            if os.path.exists(html):
                return html
        return local

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))


if not os.path.isdir(ROOT):
    sys.exit("No build found. Run:  npx expo export -p web")

socketserver.TCPServer.allow_reuse_address = True
# The bind address is the whole point: 127.0.0.1, not 0.0.0.0.
with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
    print(f"SellWant on http://127.0.0.1:{PORT}  (this machine only)")
    httpd.serve_forever()
