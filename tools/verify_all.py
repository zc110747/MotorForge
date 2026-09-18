# MotorForge one-command verification.
#
# Starts a private simulation server instance, runs both regression suites
# against it, then shuts it down and reports a single aggregate result:
#
#   tools/verify_e2e.py      - transport / state machine / load / PID plumbing
#   tools/verify_response.py - Kp, Ki x load-step dynamics (dip -> recover, droop)
#
# Usage: python tools/verify_all.py [--port 0] [--keep-dumps DIR]
#        --port 0 (default) picks a free port automatically, so the suite never
#        collides with a server you already have running on 18098.
import argparse
import os
import socket
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, "server", "build", "motorforge_server.exe")


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def wait_listening(port, timeout=20.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        s = socket.socket()
        s.settimeout(0.3)
        try:
            s.connect(("127.0.0.1", port))
            s.close()
            return True
        except OSError:
            time.sleep(0.2)
        finally:
            try:
                s.close()
            except OSError:
                pass
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--keep-dumps", default="", help="keep response time series here")
    args = ap.parse_args()

    if not os.path.exists(SERVER):
        print("FATAL: %s not found. Run server\\build.bat first." % SERVER)
        return 2

    port = args.port or free_port()
    print("=" * 68)
    print("MotorForge verification - simulation server on port %d" % port)
    print("=" * 68)

    srv = subprocess.Popen([SERVER, "--port", str(port)],
                           cwd=os.path.join(ROOT, "server"),
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not wait_listening(port):
        srv.kill()
        print("FATAL: server did not start listening on %d" % port)
        return 2

    suites = [
        ("E2E      ", ["tools/verify_e2e.py", "--port", str(port)], []),
        ("RESPONSE ", ["tools/verify_response.py", "--port", str(port)],
         ["--dump-dir", args.keep_dumps] if args.keep_dumps else []),
    ]

    summary = []
    try:
        for label, argv, extra in suites:
            print("\n" + "-" * 68)
            print("RUN %s %s" % (label.strip(), " ".join(argv + extra)))
            print("-" * 68)
            p = subprocess.run([sys.executable] + argv + extra, cwd=ROOT)
            summary.append((label.strip(), p.returncode == 0))
    finally:
        srv.terminate()
        try:
            srv.wait(timeout=5)
        except subprocess.TimeoutExpired:
            srv.kill()

    print("\n" + "=" * 68)
    ok = True
    for label, passed in summary:
        print("  [%s] %s" % ("PASS" if passed else "FAIL", label))
        ok = ok and passed
    print("===== OVERALL: %s =====" % ("ALL SUITES PASS" if ok else "FAILURES PRESENT"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
