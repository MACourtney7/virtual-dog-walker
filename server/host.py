#!/usr/bin/env python3
"""
Clifton Down: Dedicated Multiplayer Host Launcher
Single-command CLI to launch the local microserver and provision a zero-port public invite link.
"""

import argparse
import json
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.request

# Add server directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tunnel import TunnelManager, get_local_ip


def is_clifton_server(port: int) -> bool:
    """Checks if an existing Clifton Down server is already running on port."""
    try:
        url = f"http://127.0.0.1:{port}/health"
        req = urllib.request.Request(url, headers={"User-Agent": "CliftonHost/1.0"})
        with urllib.request.urlopen(req, timeout=1.0) as resp:
            data = json.loads(resp.read().decode())
            return data.get("status") == "ok"
    except Exception:
        return False


def is_port_in_use(port: int) -> bool:
    """Checks if a TCP port is currently occupied."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def print_banner(local_url: str, lan_url: str, public_url: str = None, room_id: str = "clifton-field"):
    invite_param = f"?server={public_url or local_url}&room={room_id}"
    full_public_invite = f"{public_url}{invite_param}" if public_url else None
    full_local_invite = f"{lan_url}{invite_param}"

    print("\n" + "=" * 68)
    print(" 🌲  CLIFTON DOWN: DEDICATED PARK SERVER ACTIVE  🐕")
    print("=" * 68)
    print(f" 🏠  Local Host:       {local_url}")
    print(f" 📶  Local Wi-Fi/LAN:  {lan_url}")
    if public_url:
        print(f" 🌐  Public Web URL:   {public_url}")
        print("-" * 68)
        print(" 🔗  ONE-CLICK INVITE LINK FOR FRIENDS (ANYWHERE IN THE WORLD):")
        print(f"     👉  {full_public_invite}")
    else:
        print("-" * 68)
        print(" 🔗  LOCAL NETWORK INVITE LINK:")
        print(f"     👉  {full_local_invite}")
    print("=" * 68)
    print(" 💡  Keep this terminal open while playing. Press Ctrl+C to close park.")
    print("=" * 68 + "\n")


def main():
    parser = argparse.ArgumentParser(description="Clifton Down Multiplayer Dedicated Host")
    parser.add_argument("--port", type=int, default=8080, help="Port to listen on (default: 8080)")
    parser.add_argument("--room", default="clifton-field", help="Default room code (default: clifton-field)")
    parser.add_argument("--no-tunnel", action="store_true", help="Disable public Cloudflare tunnel (LAN only)")
    parser.add_argument("--root", default=".", help="Root directory containing index.html and src/")
    args = parser.parse_args()

    project_root = os.path.abspath(args.root)
    server_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "server.py")
    server_proc = None
    target_port = args.port

    # 1. Determine server status and port availability
    if is_clifton_server(target_port):
        print(f"ℹ️  Active Clifton Down server detected on port {target_port}. Using existing server.")
    else:
        while is_port_in_use(target_port):
            print(f"⚠️  Port {target_port} is busy. Trying port {target_port + 1}...")
            target_port += 1

        print(f"🚀 Starting Clifton Down asynchronous microserver on port {target_port}...")
        server_cmd = [sys.executable, server_script, "--host", "0.0.0.0", "--port", str(target_port), "--root", project_root]
        try:
            server_proc = subprocess.Popen(server_cmd)
        except Exception as e:
            print(f"❌ Failed to launch microserver: {e}")
            sys.exit(1)

        # Wait for server readiness
        for _ in range(30):
            if is_clifton_server(target_port):
                break
            time.sleep(0.1)

    local_ip = get_local_ip()
    local_url = f"http://localhost:{target_port}"
    lan_url = f"http://{local_ip}:{target_port}"
    public_url = None

    tunnel = None
    if not args.no_tunnel:
        print("🌐 Requesting zero-port public Cloudflare tunnel...")
        tunnel = TunnelManager(local_port=target_port)
        public_url = tunnel.start_tunnel(timeout_sec=25)
        if not public_url:
            print("ℹ️  Public tunnel could not be provisioned automatically. Operating in LAN/Local mode.")

    print_banner(local_url, lan_url, public_url, args.room)

    # 2. Monitor processes and wait for exit signal
    def shutdown(signum, frame):
        print("\n🛑 Stopping Clifton Down park server and tunnel...")
        if tunnel:
            tunnel.stop()
        if server_proc and server_proc.poll() is None:
            server_proc.terminate()
            try:
                server_proc.wait(timeout=2.0)
            except subprocess.TimeoutExpired:
                server_proc.kill()
        print("👋 Park closed cleanly. Goodbye!")
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    try:
        while True:
            if server_proc and server_proc.poll() is not None:
                print("⚠️  Server process terminated.")
                break
            time.sleep(1.0)
    except KeyboardInterrupt:
        shutdown(None, None)


if __name__ == "__main__":
    main()
