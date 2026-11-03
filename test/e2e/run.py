#!/usr/bin/env python3
"""Drives real Pi in a real terminal with a fake model, and reads the raw bytes it writes.

Usage: run.py [package]     the package to test, this repository by default

Everything lives in a throwaway home directory, so no real credentials are used.
`PI_FRAME_E2E_WITH` adds packages, separated by commas, loaded before the one under test.
`PI_FRAME_E2E_AFTER` adds packages loaded after it.
"""
import fcntl, json, os, pty, re, select, shutil, signal, stat, struct, subprocess, sys, tempfile, termios, time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
PI = REPO / "node_modules/.bin/pi"
PACKAGE = sys.argv[1] if len(sys.argv) > 1 else str(REPO)
EXTRA = [p for p in os.environ.get("PI_FRAME_E2E_WITH", "").split(",") if p]
AFTER = [p for p in os.environ.get("PI_FRAME_E2E_AFTER", "").split(",") if p]
PORT = 20000 + os.getpid() % 2000
ESC = "\x1b"
PRIVATE_USE = re.compile("[-\U000f0000-\U0010ffff]")

root = Path(tempfile.mkdtemp(prefix="pi-frame-e2e-"))
home, agent, project, bin_dir = root / "home", root / "home/.pi/agent", root / "project", root / "bin"
agent.mkdir(parents=True)
project.mkdir()
bin_dir.mkdir()

gh_log = root / "gh.log"
fake_gh = bin_dir / "gh"
fake_gh.write_text(f'#!/bin/sh\necho "$@" >> "{gh_log}"\necho "[]"\n')
fake_gh.chmod(0o755)

env = {
    "PATH": f"{bin_dir}:{os.environ['PATH']}", "HOME": str(home), "TERM": "xterm-256color", "COLUMNS": "120", "LINES": "45",
    "LANG": "en_US.UTF-8", "PI_CODING_AGENT_DIR": str(agent), "PI_SKIP_VERSION_CHECK": "1",
}


def git(*args, cwd=project):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, env=env)


git("init", "-q")
git("remote", "add", "origin", "git@gitlab.com:team/app.git")
monitor = root / "monitor.sh"
marker = root / "monitor-ran"
monitor.write_text(f'#!/bin/sh\ntouch "{marker}"\n')
monitor.chmod(0o755)
git("config", "core.fsmonitor", str(monitor))
(project / "untracked.txt").write_text("x")

(agent / "models.json").write_text(json.dumps({"providers": {"mock": {
    "baseUrl": f"http://127.0.0.1:{PORT}/v1", "apiKey": "unused", "api": "openai-completions",
    "models": [{"id": "m", "name": "Mock", "contextWindow": 100000, "maxTokens": 1000, "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}}],
}}}))
settings = {"defaultProvider": "mock", "defaultModel": "m", "defaultThinkingLevel": "off", "npmCommand": ["npm", "--ignore-scripts"], "packages": []}
(agent / "settings.json").write_text(json.dumps(settings))
for source in [*EXTRA, PACKAGE, *AFTER]:
    if source.startswith("npm:"):
        subprocess.run([str(PI), "install", source], env=env, check=True, capture_output=True, cwd=project, timeout=240)
    else:
        current = json.loads((agent / "settings.json").read_text())
        current["packages"].append(source)
        (agent / "settings.json").write_text(json.dumps(current))
env["PI_OFFLINE"] = "1"

model = subprocess.Popen(["node", str(Path(__file__).parent / "mock-model.mjs"), str(PORT)])
time.sleep(0.5)


class Terminal:
    def __init__(self):
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.chdir(project)
            os.execve(str(PI), [str(PI)], env)
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", 45, 120, 0, 0))
        self.raw = ""

    def pump(self, seconds):
        end = time.time() + seconds
        while time.time() < end:
            if select.select([self.fd], [], [], 0.1)[0]:
                try:
                    self.raw += os.read(self.fd, 65536).decode("utf8", "replace")
                except OSError:
                    return

    def wait(self, text, timeout=30):
        end = time.time() + timeout
        while time.time() < end:
            self.pump(0.2)
            if text in self.plain():
                return True
        return False

    def plain(self):
        return re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]", "", self.raw)

    def prompt(self, text):
        mark = self.plain().count("FINISHED") + self.plain().count("OK")
        os.write(self.fd, text.encode())
        self.pump(0.4)
        os.write(self.fd, b"\r")
        end = time.time() + 30
        while time.time() < end and self.plain().count("FINISHED") + self.plain().count("OK") <= mark:
            self.pump(0.2)
        self.pump(1)

    def close(self):
        try:
            os.kill(self.pid, signal.SIGKILL)
            os.waitpid(self.pid, 0)
        except OSError:
            pass


checks = []


def check(name, ok, detail=""):
    checks.append((name, ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


term = Terminal()
try:
    check("starts", term.wait("Mock", 40))
    term.pump(3)
    if PACKAGE == str(REPO):
        check("the start card uses the new name", "\u03c0-frame" in term.plain())
    check("repository's fsmonitor does not run at startup", not marker.exists())
    check("no icon that needs a special font", not PRIVATE_USE.search(term.raw), repr(PRIVATE_USE.findall(term.raw)[:3]))
    check("gh is not started for a GitLab remote", not gh_log.exists())

    term.prompt("PRINT")
    term.prompt("ARG")
    term.prompt("CUSTOM")
    term.pump(2)
    check("repository's fsmonitor does not run after tool calls", not marker.exists())
    os.write(term.fd, b"\x1bo")
    term.pump(1.5)
    os.write(term.fd, b"\x1b[C\x1b[D\x1b[D\x1b[D")
    term.pump(1.5)
    os.write(term.fd, b"\x1b")
    term.pump(1)
    for name, needle in [
        ("clipboard write", f"{ESC}]52;"),
        ("title from a tool's output", f"{ESC}]0;EVILTITLE"),
        ("title from a tool's argument", f"{ESC}]0;ARGTITLE"),
        ("title from an unknown tool", f"{ESC}]0;CUSTOMTITLE"),
    ]:
        check(f"no {name} reaches the terminal", needle not in term.raw)
    check("command output still shows", "printed" in term.plain())
    check("git counts still show", "?1" in term.plain() or "? 1" in term.plain())
    term.close()

    git("remote", "set-url", "origin", "git@github.com:team/app.git")
    term = Terminal()
    term.wait("Mock", 40)
    term.pump(3)
    check("gh is started for a GitHub remote", gh_log.exists())
finally:
    term.close()
    model.terminate()

failed = [name for name, ok in checks if not ok]
print(f"\n{len(checks) - len(failed)}/{len(checks)} passed ({PACKAGE})")
if not failed:
    shutil.rmtree(root, ignore_errors=True)
else:
    print("kept", root)
sys.exit(1 if failed else 0)
