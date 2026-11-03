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

glab_log = root / "glab.log"
fake_glab = bin_dir / "glab"
fake_glab.write_text(f"""#!/bin/sh
echo "$@" >> "{glab_log}"
case "$1" in
  ci) echo '[{{"status":"failed","sha":"abcdef1234567","ref":"main"}}]' ;;
  mr) echo '[{{"iid":7,"title":"Fix it","detailed_merge_status":"requested_changes"}}]' ;;
esac
""")
fake_glab.chmod(0o755)
gh_log = root / "gh.log"
fake_gh = bin_dir / "gh"
fake_gh.write_text(f'#!/bin/sh\necho "$@" >> "{gh_log}"\necho "[]"\n')
fake_gh.chmod(0o755)

env = {
    "PATH": f"{bin_dir}:{os.environ['PATH']}", "HOME": str(home), "TERM": "xterm-256color", "COLUMNS": "120", "LINES": "45",
    "LANG": "en_US.UTF-8", "PI_CODING_AGENT_DIR": str(agent), "PI_SKIP_VERSION_CHECK": "1",
}


if any("pi-permission-system" in p for p in EXTRA):
    for name, config in (
        ("pi-permission-system", {"authorizerChain": ["pi-modes", "permission-judge"], "permission": {"*": "allow"}}),
        ("pi-permission-classifier", {}),
    ):
        (agent / "extensions" / name).mkdir(parents=True)
        (agent / "extensions" / name / "config.json").write_text(json.dumps(config))


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
    "models": [{"id": "m", "name": "Mock", "reasoning": True, "contextWindow": 100000, "maxTokens": 1000, "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}}],
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
    def __init__(self, kitty=False):
        self.kitty = kitty
        self.answered = False
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

    def answer_kitty(self):
        # What a terminal with the kitty keyboard protocol says when asked.
        if self.kitty and not self.answered and "\x1b[?u" in self.raw:
            self.answered = True
            os.write(self.fd, b"\x1b[?1u")

    def wait(self, text, timeout=30):
        end = time.time() + timeout
        while time.time() < end:
            self.pump(0.2)
            self.answer_kitty()
            if text in self.plain():
                return True
        return False

    def send(self, text):
        os.write(self.fd, text.encode())

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
SHIFT_TAB = b"\x1b[Z"
MODES_LOADED = any("pi-modes" in source for source in EXTRA)


def frame_color():
    """The color of the most recent editor frame: the start card is drawn only at the top."""
    found = re.findall(r"(\x1b\[[0-9;:]*m)\u256d\u2500", term.raw)
    return found[-1] if found else None


def effort_on_frame():
    found = re.findall(r"\u2502 +(off|minimal|low|medium|high|xhigh|max) ", term.plain())
    return found[-1] if found else None


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

    if PACKAGE == str(REPO):
        hints = re.sub(r"\s+", " ", term.plain())
        check("the effort shows after a divider", "\u2502 off" in hints or "\u2502  off" in hints)
        check("no effort meter", "\u2582\u2583" not in hints)
        if MODES_LOADED:
            check("the start card says shift+tab changes the mode", "shift+tab mode" in hints)
            check("the start card does not say it changes the effort", "shift+tab effort" not in hints)
            check("the start card names /effort", "/effort effort" in hints)
            colors = {"normal": frame_color()}
            for mode in ("auto", "plan", "read-only", "normal"):
                os.write(term.fd, SHIFT_TAB)
                term.wait(f"mode: {mode}")
                term.pump(1)
                colors[f"back to {mode}" if mode == "normal" else mode] = frame_color()
            check(
                "the frame changes color with the mode",
                len({colors["normal"], colors["auto"], colors["plan"], colors["read-only"]}) == 4,
                str(colors).replace(ESC, "ESC"),
            )
            check("the frame returns to its color in normal", colors["back to normal"] == colors["normal"])
            os.write(term.fd, b"/mode yolo")
            term.pump(0.4)
            os.write(term.fd, b"\x1b")
            term.pump(0.4)
            os.write(term.fd, b"\r")
            term.pump(1)
            check("/mode yolo asks first", term.wait("Enter start", 5))
            os.write(term.fd, b"\r")
            check("the footer shows yolo without another key", term.wait("mode: yolo", 5))
            term.pump(1)
            yolo = frame_color()
            check("yolo has its own frame color", yolo not in colors.values(), str(yolo).replace(ESC, "ESC"))
            os.write(term.fd, SHIFT_TAB)
            term.pump(1)
            plain = term.plain()
            check("the skill is listed", "review-permissions" in plain)
            check("the skills list is framed", "\u2500 skills " in plain and "[Skills]" not in plain)
        os.write(term.fd, b"/effort high")
        term.pump(0.5)
        os.write(term.fd, b"\x1b")
        term.pump(0.3)
        os.write(term.fd, b"\r")
        check("/effort high changes the effort", term.wait("Effort: high", 10))
        term.pump(1)
        check("the frame shows the new effort", effort_on_frame() == "high", str(effort_on_frame()))
        os.write(term.fd, b"/effort")
        term.pump(0.5)
        os.write(term.fd, b"\x1b")
        term.pump(0.3)
        os.write(term.fd, b"\r")
        check("/effort opens a picker", term.wait("Effort (now high)", 10))
        term.pump(0.5)
        os.write(term.fd, b"\x1b")
        term.pump(1)

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
    if any("pi-permission-system" in p for p in EXTRA):
        drawn = re.search(r"(\x1b\[[\d;]*m)perm-judge: ", term.raw)
        check("the judge's status is drawn dim", drawn is not None, repr(drawn.group(1)) if drawn else "not drawn")
    check("git counts still show", "?1" in term.plain() or "? 1" in term.plain())
    term.close()

    git("remote", "set-url", "origin", "git@github.com:team/app.git")
    glab_log.unlink(missing_ok=True)
    term = Terminal()
    term.wait("Mock", 40)
    term.pump(3)
    check("gh is started for a GitHub remote", gh_log.exists())
    check("glab is not started for a GitHub remote", not glab_log.exists())
    term.close()

    git("remote", "set-url", "origin", "git@gitlab.com:team/app.git")
    gh_log.unlink()
    term = Terminal()
    term.wait("Mock", 40)
    term.pump(3)
    check("glab is started for a GitLab remote", glab_log.exists())
    check("gh is not started for a GitLab remote", not gh_log.exists())
    plain = term.plain()
    check("the start card shows the failed pipeline", "CI failed on" in plain, plain[-300:] if "CI failed on" not in plain else "")
    check("the start card shows the merge request", "MR !7" in plain)
    for section in ("extensions",):
        check(f"Pi's {section} list is framed", f"\u2500 {section} " in plain)
    check("no bracketed section names", "[Extensions]" not in plain)
    if sys.platform == "darwin":
        check("the card says option, not alt", "option+s settings" in plain and "alt+s" not in plain)

    started = time.time()
    term.send("SLEEP")
    term.pump(0.4)
    term.send("\r")
    term.pump(3)
    check("the run is going", term.wait("sleep 20", 5) and "Aborted" not in term.plain())
    term.send("\x03")
    check("ctrl+c stops a run and says so", term.wait("Aborted", 5) and time.time() - started < 12)
    term.pump(1)
    alive = lambda: os.waitpid(term.pid, os.WNOHANG)[0] == 0
    check("stopping a run does not exit", alive())
    term.pump(1.5)
    term.send("\x03")
    check("with nothing running, ctrl+c says how to exit", term.wait("Press ctrl+c again to exit", 5))
    Path(os.environ.get("PI_FRAME_E2E_RAW", os.devnull)).write_text(term.raw)
    term.pump(3)
    term.send("\x03")
    term.pump(1)
    check("after the warning passes, it warns again", alive())
    term.send("\x03")
    term.pump(3)
    check("the second press exits", not alive())

    if sys.platform == "darwin":
        term = Terminal(kitty=True)
        term.wait("Mock", 40)
        term.pump(3)
        term.answer_kitty()
        term.pump(2)
        term.send("x")
        term.pump(2)
        os.write(term.fd, b"\x1b[127u")
        term.pump(1.5)
        check("with the kitty protocol, the card says cmd+s", "cmd+s settings" in term.plain())
        before = len(term.plain())
        os.write(term.fd, b"\x1b[115;9u")
        check("cmd+s opens the settings", term.wait("Frame", 8) and "Frame" in term.plain()[before:])
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
