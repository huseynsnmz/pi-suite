#!/usr/bin/env python3
"""Drives real Pi in a real terminal: every part loads from one entry, and /suite turns them off."""
import fcntl, json, os, pty, re, select, shutil, signal, struct, subprocess, sys, tempfile, termios, time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
PI = REPO / "node_modules/.bin/pi"
PORT = 24000 + os.getpid() % 2000
ESC = "\x1b"
ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]")

root = Path(tempfile.mkdtemp(prefix="pi-suite-e2e-"))
home, agent, project, log = root / "home", root / "home/.pi/agent", root / "project", root / "requests.jsonl"
agent.mkdir(parents=True)
project.mkdir()
log.touch()
(project / "AGENTS.md").write_text("Be brief.\n")
env = {"PATH": os.environ["PATH"], "HOME": str(home), "TERM": "xterm-256color", "LANG": "en_US.UTF-8", "PI_CODING_AGENT_DIR": str(agent), "PI_SKIP_VERSION_CHECK": "1", "PI_OFFLINE": "1"}
(agent / "models.json").write_text(json.dumps({"providers": {"mock": {
    "baseUrl": f"http://127.0.0.1:{PORT}/v1", "apiKey": "unused", "api": "openai-completions",
    "models": [{"id": "m", "name": "Mock", "contextWindow": 100000, "maxTokens": 1000, "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}}],
}}}))
(agent / "settings.json").write_text(json.dumps({"defaultProvider": "mock", "defaultModel": "m", "defaultThinkingLevel": "off", "packages": [str(REPO)]}))
model = subprocess.Popen(["node", str(REPO / "packages/router/test/e2e/mock-model.mjs"), str(PORT), str(log)])
time.sleep(0.5)
PART_TOOLS = {"modes": "ask_questions", "web": "web_fetch", "frame": "todo"}
checks = []


def check(name, ok, detail=""):
    checks.append((name, ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


class Terminal:
    def __init__(self):
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.chdir(project)
            os.execve(str(PI), [str(PI)], env)
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", 45, 130, 0, 0))
        self.text = ""

    def pump(self, seconds):
        end = time.time() + seconds
        while time.time() < end:
            if select.select([self.fd], [], [], 0.1)[0]:
                try:
                    self.text += ANSI.sub("", os.read(self.fd, 65536).decode("utf8", "replace"))
                except OSError:
                    return

    def wait(self, words, since=0, timeout=30):
        end = time.time() + timeout
        while time.time() < end:
            self.pump(0.2)
            if words in self.text[since:]:
                return True
        return False

    def send(self, data):
        os.write(self.fd, data.encode())

    def command(self, text):
        self.send(text)
        self.pump(0.4)
        self.send(ESC)
        self.pump(0.3)
        self.send("\r")
        self.pump(1)

    def close(self):
        try:
            os.kill(self.pid, signal.SIGKILL)
            os.waitpid(self.pid, 0)
        except OSError:
            pass


def tools_with(off):
    (agent / "suite.json").write_text(json.dumps({"off": off}))
    child = subprocess.run([str(PI), "-p", "hello"], env=env, cwd=project, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=90)
    return json.loads(log.read_text().splitlines()[-1]).get("toolNames", []), child


term = None
try:
    tools, child = tools_with([])
    check("every part loads from the one entry", all(tool in tools for tool in PART_TOOLS.values()), str(tools))
    check("nothing complains when it all loads", "failed to load" not in child.stderr + child.stdout, (child.stderr + child.stdout)[-200:])
    for part, tool in PART_TOOLS.items():
        tools, _ = tools_with([part])
        others = [other for name, other in PART_TOOLS.items() if name != part]
        check(f"turning off {part} removes {tool}, and only that", tool not in tools and all(other in tools for other in others), str(tools))
    tools, child = tools_with(["modes", "router", "web", "memory", "frame", "board"])
    check("with every part off, Pi still works", "OK" in child.stdout and not set(PART_TOOLS.values()) & set(tools), str(tools))
    (agent / "suite.json").write_text('{"off":["modes","wbe"]}')
    child = subprocess.run([str(PI), "-p", "hello"], env=env, cwd=project, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=90)
    check("a typo in suite.json leaves everything on", "ask_questions" in json.loads(log.read_text().splitlines()[-1])["toolNames"])

    (agent / "suite.json").unlink()
    term = Terminal()
    check("starts, with the frame", term.wait("Mock"))
    term.pump(3)
    check("skills from parts that are on are listed", "review-permissions" in term.text)
    term.command("/suite list")
    term.pump(0.5)
    check("/suite list shows every part", all(f"{part}: on" in term.text for part in ("modes", "router", "web", "memory", "frame", "board")), term.text[-400:])
    mark = len(term.text)
    term.command("/suite")
    check("/suite opens a list", term.wait("Enter turns a part on or off", mark, 8))
    term.pump(0.5)
    term.send("\x1b[B\x1b[B")
    term.pump(0.4)
    term.send("\r")
    term.pump(0.8)
    mark = len(term.text)
    term.send(ESC)
    term.pump(0.8)
    check("the list saves the choice", json.loads((agent / "suite.json").read_text()) == {"off": ["web"]}, (agent / "suite.json").read_text())
    check("it offers to reload", term.wait("Reload Pi now", mark, 6))
    term.pump(0.3)
    term.send("\r")
    term.pump(5)
    term.command("/suite list")
    term.pump(0.5)
    check("after the reload, web is off", "web: off" in term.text, term.text[-300:])
    mark = len(term.text)
    term.command("/suite off modes")
    check("turning off modes asks first", term.wait("Turn off modes", mark, 6))
    term.pump(0.3)
    term.send(ESC)
    term.pump(0.8)
    check("saying no leaves it on", "modes" not in json.loads((agent / "suite.json").read_text())["off"])
    term.close()
    term = None
    (agent / "suite.json").write_text(json.dumps({"off": ["modes"]}))
    term = Terminal()
    term.wait("Mock")
    term.pump(3)
    check("a part that's off doesn't offer its skills", "review-permissions" not in term.text)
    term.close()
    term = None
    (agent / "suite.json").write_text("{oops")
    term = Terminal()
    check("a broken suite.json says so", term.wait("isn't valid JSON"))
except Exception as error:
    check(f"stopped early: {error}", False)
finally:
    if term is not None:
        Path(root / "screen.txt").write_text(term.text)
        term.close()
    model.terminate()

failed = [name for name, ok in checks if not ok]
print(f"\n{len(checks) - len(failed)}/{len(checks)} passed")
if failed:
    print("kept", root)
else:
    shutil.rmtree(root, ignore_errors=True)
sys.exit(1 if failed else 0)
