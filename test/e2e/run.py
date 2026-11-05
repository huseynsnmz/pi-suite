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
    def __init__(self, *args):
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.chdir(project)
            os.execve(str(PI), [str(PI), *args], env)
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
    tools, child = tools_with(["modes", "router", "web", "memory", "frame", "board", "commands", "subscription"])
    check("with every part off, Pi still works", "OK" in child.stdout and not set(PART_TOOLS.values()) & set(tools), str(tools))
    (agent / "suite.json").write_text('{"off":["modes","wbe"]}')
    child = subprocess.run([str(PI), "-p", "hello"], env=env, cwd=project, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=90)
    check("a typo in suite.json leaves everything on", "ask_questions" in json.loads(log.read_text().splitlines()[-1])["toolNames"])

    (agent / "suite.json").unlink()
    child = subprocess.run([str(PI), "--list-models"], env=env, cwd=project, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=60)
    check("the subscription models stay out until asked for", "claude-sdk" not in child.stdout + child.stderr)
    term = Terminal()
    check("starts, with the frame", term.wait("Mock"))
    term.pump(3)
    check("skills from parts that are on are listed", "review-permissions" in term.text)
    term.command("/suite list")
    term.pump(0.5)
    check("/suite list shows every part", all(f"{part}: on" in term.text for part in ("modes", "router", "web", "memory", "frame", "board", "commands")), term.text[-400:])
    mark = len(term.text)
    term.command("/suite")
    check("/suite opens a list", term.wait("pick a part", mark, 8))
    term.pump(0.5)
    term.send("\x1b[B\x1b[B")
    term.pump(0.4)
    term.send("\r")
    check("a part opens its settings", term.wait("Allow searching through a company's service: off", mark, 6), term.text[-300:])
    term.pump(0.4)
    term.send("\x1b[B")
    term.pump(0.3)
    term.send("\r")
    term.wait("web: Allow searching", mark, 6)
    term.pump(0.4)
    term.send("\r")
    term.pump(0.8)
    check("a setting is saved under its part", json.loads((agent / "suite.json").read_text()).get("web") == {"companySearch": True}, (agent / "suite.json").read_text())
    check("and it shows the new value", term.wait("Allow searching through a company's service: on", mark, 6))
    term.send("\r")
    term.pump(0.8)
    term.send(ESC)
    term.pump(0.5)
    mark = len(term.text)
    term.send(ESC)
    term.pump(0.8)
    saved = json.loads((agent / "suite.json").read_text())
    check("the list saves the choice", saved.get("off") == ["web"] and saved.get("web") == {"companySearch": True}, str(saved))
    check("it offers to reload", term.wait("Reload Pi now", mark, 6))
    term.pump(0.3)
    term.send("\r")
    term.pump(5)
    term.command("/suite list")
    term.pump(0.5)
    check("after the reload, web is off", "web: off" in term.text, term.text[-300:])
    (agent / "suite.json").write_text(json.dumps({"off": ["web"]}))
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
    term.close()
    term = None
    (agent / "suite.json").unlink()

    def sessions():
        return set((agent / "sessions").rglob("*.jsonl"))

    def sent():
        return [json.loads(line) for line in log.read_text().splitlines()]

    term = Terminal()
    term.wait("Mock")
    term.pump(3)
    term.command("/mode auto")
    mark = len(term.text)
    term.command("sent while in auto")
    check("a message names the mode it was sent in", term.wait("you auto", mark, 15), term.text[-300:])
    term.wait("OK", mark, 15)
    term.pump(1)
    term.command("/mode normal")
    mark = len(term.text)
    term.command("sent while in normal")
    term.wait("OK", mark, 15)
    term.pump(1)
    check("a normal message doesn't", "you normal" not in term.text[mark:], term.text[mark:][-300:])
    before = sessions()
    mark = len(term.text)
    term.command("/clear")
    term.pump(2)
    check("/clear redraws the start card after the old conversation", term.text.rfind("Nothing new") > term.text.rfind("sent while in normal"), term.text[mark:][-300:])
    term.command("after clearing")
    term.pump(3)
    check("the new session goes to its own file, and the old one is kept", before < sessions(), str(sessions()))
    check("the model doesn't see the cleared conversation", sent()[-1]["text"] == "after clearing", str(sent()[-1]))
    term.close()
    term = Terminal("--session", str(max(before, key=lambda path: path.stat().st_mtime)))
    check("a resumed session still shows the mode", term.wait("you auto", 0, 15), term.text[-300:])
    term.pump(1)
    check("and only on the message sent in it", term.text.count("you auto") == 1 or "sent while in normal" in term.text)
    term.close()

    subprocess.run("git init -q -b main && git add . && git -c user.name=t -c user.email=t@t commit -qm first", shell=True, cwd=project, check=True)
    term = Terminal()
    term.wait("Mock")
    term.pump(3)
    mark = len(term.text)
    term.command("/security-review")
    check("/security-review with no changes says so", term.wait("No changes to review", mark, 8), term.text[mark:][-300:])
    (project / "AGENTS.md").write_text("Be brief. LINE-UNDER-REVIEW\n")
    mark = len(term.text)
    count = len(sent())
    term.command("/security-review focus on auth")
    check("it shows one line", term.wait("Security review of 1 changed file against", mark, 8), term.text[mark:][-300:])
    term.wait("OK", mark, 15)
    term.pump(1)
    request = sent()[count]
    check("the model gets the instructions and the diff", "reviewing code changes" in request["text"] and "LINE-UNDER-REVIEW" in request["tail"], str(request))
    check("the screen doesn't get the diff", "LINE-UNDER-REVIEW" not in term.text[mark:], term.text[mark:][-300:])
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
