#!/usr/bin/env python3
"""Drives real Pi in a real terminal with a fake model.

Usage: run.py <solo|modes-first|modes-last|classifier-last>

  solo         only this extension
  modes-first  your five extensions, with this one loaded first
  modes-last   your five extensions, with this one loaded last
  classifier-last  this one first, and the classifier after the permission system

Everything lives in a throwaway home directory, so no real credentials are used.
The modes-* runs install the third-party packages from npm with scripts disabled
and start them, so run those yourself.
"""
import fcntl, json, os, pty, re, select, shutil, signal, struct, subprocess, sys, tempfile, termios, time
from pathlib import Path

ORDER = sys.argv[1]
SOLO = ORDER == "solo"
REPO = Path(__file__).resolve().parents[2]
PI = REPO / "node_modules/.bin/pi"
THIRD_PARTY = [] if SOLO else [
    "npm:pi-permission-classifier@0.6.0",
    "npm:@gotgenes/pi-permission-system@42.0.0",
    "npm:pi-subagents@0.84.0",
    "npm:pi-claude-code-ui@1.0.107",
    "npm:@adeildo/pi-look@6.0.0",
]
if ORDER == "classifier-last":
    THIRD_PARTY[0], THIRD_PARTY[1] = THIRD_PARTY[1], THIRD_PARTY[0]
PORT = 18000 + os.getpid() % 2000
root = Path(tempfile.mkdtemp(prefix="pi-modes-e2e-"))
home, agent, project = root / "home", root / "home/.pi/agent", root / "project"
(agent / "extensions/pi-permission-system").mkdir(parents=True)
(agent / "extensions/pi-permission-classifier").mkdir(parents=True)
project.mkdir()
log = root / "model.log"
log.touch()

env = {
    "PATH": os.environ["PATH"], "HOME": str(home), "TERM": "xterm-256color", "COLUMNS": "140", "LINES": "45",
    "LANG": "en_US.UTF-8", "PI_CODING_AGENT_DIR": str(agent), "PI_SKIP_VERSION_CHECK": "1",
}

(agent / "models.json").write_text(json.dumps({"providers": {"mock": {
    "baseUrl": f"http://127.0.0.1:{PORT}/v1", "apiKey": "unused", "api": "openai-completions",
    "models": [{"id": "m", "name": "Mock", "contextWindow": 100000, "maxTokens": 1000, "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}}],
}}}))
(agent / "extensions/pi-permission-system/config.json").write_text(json.dumps({
    "doublePressToConfirm": False, "authorizerChain": [] if SOLO else ["pi-modes", "permission-judge"],
    "permission": {"*": "ask", "bash": {"*": "ask", "touch denied*": "deny"}, "path": {"*": "allow", "*.secret": "deny"}, "read": "allow", "submit_plan": "allow", "external_directory": "allow"},
}))
(agent / "extensions/pi-permission-classifier/config.json").write_text("{}")
(agent / "settings.json").write_text(json.dumps({
    "defaultProvider": "mock", "defaultModel": "m", "defaultThinkingLevel": "off", "npmCommand": ["npm", "--ignore-scripts"],
}))
for source in THIRD_PARTY:
    subprocess.run([str(PI), "install", source], env=env, check=True, capture_output=True, cwd=project, timeout=240)
current = json.loads((agent / "settings.json").read_text())
installed = current.get("packages", [])
current["packages"] = installed + [str(REPO)] if ORDER in ("solo", "modes-last") else [str(REPO)] + installed
(agent / "settings.json").write_text(json.dumps(current))
print("load order:", [str(p).split("/")[-1] for p in current["packages"]], flush=True)
env["PI_OFFLINE"] = "1"

model = subprocess.Popen(["node", str(Path(__file__).parent / "mock-model.mjs"), str(PORT), str(log)])
time.sleep(0.5)
ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]")


class Terminal:
    def __init__(self, *args):
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.chdir(project)
            os.execve(str(PI), [str(PI), *args], env)
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", 45, 140, 0, 0))
        self.text = ""
        self.mark = 0

    def pump(self, seconds):
        end = time.time() + seconds
        while time.time() < end:
            ready, _, _ = select.select([self.fd], [], [], 0.1)
            if ready:
                try:
                    data = os.read(self.fd, 65536)
                except OSError:
                    return
                self.text += ANSI.sub("", data.decode("utf8", "replace"))

    def wait(self, pattern, timeout=25):
        end = time.time() + timeout
        while time.time() < end:
            self.pump(0.2)
            found = re.search(pattern, self.text[self.mark:])
            if found:
                self.mark += found.end()
                return True
        tail = re.sub(r"\s+", " ", self.text)[-1500:]
        raise AssertionError(f"timed out waiting for {pattern!r}\n--- screen tail ---\n{tail}\n--- model log ---\n{log.read_text()}")

    def until(self, condition, what, timeout=25):
        end = time.time() + timeout
        while time.time() < end:
            self.pump(0.2)
            if condition():
                return
        tail = re.sub(r"\s+", " ", self.text)[-1500:]
        raise AssertionError(f"timed out waiting for {what}\n--- screen tail ---\n{tail}\n--- model log ---\n{log.read_text()}")

    def send(self, data):
        os.write(self.fd, data.encode())

    def prompt(self, text):
        self.send(text)
        self.pump(0.4)
        self.send("\r")

    def close(self):
        try:
            os.kill(self.pid, signal.SIGKILL)
            os.waitpid(self.pid, 0)
        except OSError:
            pass


def judge_calls():
    return log.read_text().splitlines().count("judge")


checks = []


def check(name, ok, detail=""):
    checks.append((name, ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


SHIFT_TAB = "\x1b[Z"
# Loaded last, this extension's check runs after the permission system's dialog.
DIALOG_FIRST = ORDER == "modes-last"


def ask_yolo():
    # Esc closes the autocomplete list, which would otherwise take the Enter.
    term.send("/mode yolo")
    term.pump(0.4)
    term.send("\x1b")
    term.pump(0.4)
    term.send("\r")


def confirm_yolo():
    term.send("\r")
    term.pump(1)
    # pi-look keeps its footer drawing for 100 ms, so a key makes it show the new mode.
    term.send(" ")
    term.pump(0.2)
    term.send("\x7f")
    term.wait(r"mode: yolo")


def approve_dialog_if_first():
    if DIALOG_FIRST:
        term.pump(2)
        term.send("y")


term = Terminal()
try:
    term.wait(r"mode: normal", 40)
    term.pump(1.5)
    check("footer shows the mode", True)
    if not SOLO:
        term.send(SHIFT_TAB)
        term.wait(r"mode: auto")
        term.pump(1.5)
        check("auto: no false warning before the first prompt", "Auto has no permission judge" not in term.text)
        for name in ("plan", "read-only", "normal"):
            term.send(SHIFT_TAB)
            term.wait(f"mode: {name}")
        term.pump(1)
    check("warns only when loaded after the permission system", ("loads after pi-permission-system" in term.text) == DIALOG_FIRST)

    term.prompt("RUN:touch normal.txt")
    if SOLO:
        term.until((project / "normal.txt").exists, "normal.txt")
        check("normal: extension does not restrict tools", True)
    else:
        term.wait(r"touch normal\.txt")
        term.pump(1.5)
        check("normal: judge is not called", judge_calls() == 0, f"judge={judge_calls()}")
        check("normal: command waits for the human", not (project / "normal.txt").exists())
        term.send("y")
        term.until((project / "normal.txt").exists, "normal.txt")
        check("normal: approving the prompt runs it", True)
    term.pump(1)

    term.send(SHIFT_TAB)
    term.wait(r"mode: auto")
    check("shift+tab switches to auto", True)
    if SOLO:
        term.pump(1)
        check("auto warns when no judge is installed", "Auto has no permission judge" in term.text)
    else:
        term.prompt("RUN:touch auto.txt")
        term.until((project / "auto.txt").exists, "auto.txt")
        check("auto: judge decides and the command runs without a prompt", judge_calls() == 1, f"judge={judge_calls()}")
    term.pump(1)

    term.send(SHIFT_TAB)
    term.wait(r"mode: plan")
    check("shift+tab switches to plan", True)
    before = judge_calls()
    term.prompt("WRITE:plan.txt")
    approve_dialog_if_first()
    term.wait(r"plan mode blocks write")
    check("plan: write is blocked", not (project / "plan.txt").exists())
    check("plan: judge stays out", judge_calls() == before, f"judge={judge_calls()}")
    chat = log.read_text().splitlines()
    check("plan: instructions and submit tool reach the model", any("plan=true" in l and "submit=true" in l for l in chat))
    check("normal: submit tool was hidden from the model", "submit=false" in chat[0])
    term.pump(1)

    term.prompt("RUN:touch planask.txt")
    approve_dialog_if_first()
    term.wait(r"Plan mode: run this command")
    term.pump(0.5)
    term.send("\x1b")
    term.wait(r"Plan mode blocked this command")
    check("plan: declining a command blocks it", not (project / "planask.txt").exists())
    term.pump(1)

    term.prompt("PLAN")
    term.wait(r"Approve this plan")
    check("plan: the plan is shown before approval", "PLANBODY" in term.text)
    term.pump(0.5)
    term.send("\r")
    term.wait(r"approved the plan and switched to normal")
    term.wait(r"mode: normal")
    check("approving the plan returns to normal", True)
    term.pump(1)

    term.send(SHIFT_TAB); term.wait(r"mode: auto")
    term.send(SHIFT_TAB); term.wait(r"mode: plan")
    term.send(SHIFT_TAB); term.wait(r"mode: read-only")
    check("shift+tab reaches read-only", True)
    before = judge_calls()
    term.prompt("RUN:touch readonly.txt")
    approve_dialog_if_first()
    term.wait(r"read-only mode blocked this command")
    check("read-only: other bash stays blocked", not (project / "readonly.txt").exists())
    check("read-only: judge stays out", judge_calls() == before, f"judge={judge_calls()}")
    term.pump(1)
    term.prompt("RUN:echo READONLY_OK")
    if not SOLO:
        term.pump(2)
        term.send("y")
    term.wait(r"FINISHED READONLY_OK")
    check("read-only: read-only bash runs", True)
    term.pump(1)
    term.send(SHIFT_TAB)
    term.wait(r"mode: normal")
    check("shift+tab wraps back to normal", True)

    ask_yolo()
    term.wait(r"Enter start")
    term.pump(0.5)
    term.send("y")
    term.pump(0.5)
    term.send("\x1b")
    term.pump(1)
    check("yolo: y does not confirm and Esc cancels", "mode: yolo" not in term.text)
    ask_yolo()
    term.mark = len(term.text)
    term.wait(r"Enter start")
    term.pump(0.5)
    confirm_yolo()
    check("yolo: Enter starts it", True)
    before = judge_calls()
    term.prompt("RUN:touch yolo.txt")
    term.until((project / "yolo.txt").exists, "yolo.txt")
    check("yolo: a command runs without a prompt", True)
    check("yolo: judge stays out", judge_calls() == before, f"judge={judge_calls()}")
    term.pump(1)
    if not SOLO:
        term.prompt("RUN:touch denied.txt")
        term.wait(r"FINISHED")
        term.pump(1)
        check("yolo: deny rules still block", not (project / "denied.txt").exists())
        term.prompt("WRITE:deny.secret")
        term.pump(3)
        check("yolo: a deny on a path still blocks", not (project / "deny.secret").exists())
    term.send(SHIFT_TAB)
    term.wait(r"mode: normal")
    check("shift+tab leaves yolo for normal", True)
    if not SOLO:
        term.pump(1)
        ask_yolo()
        term.mark = len(term.text)
        term.wait(r"Enter start")
        term.pump(0.5)
        term.send("d")
        term.wait(r"IGNORED")
        term.pump(0.3)
        confirm_yolo()
        term.wait(r"deny rules off")
        check("yolo: d turns deny off, and the footer says so", True)
        term.prompt("RUN:touch denied.txt")
        term.until((project / "denied.txt").exists, "denied.txt")
        check("deny off: a denied command runs", True)
        term.pump(1)
        term.prompt("WRITE:deny.secret")
        term.until((project / "deny.secret").exists, "deny.secret")
        check("deny off: a denied path can be written", True)
        chat = log.read_text().splitlines()
        check("deny off: the model gets the other tools instead of bash", "bash=false alias=true" in chat[-1], chat[-1])
        term.pump(1)
        term.send(SHIFT_TAB)
        term.wait(r"mode: normal")
        term.pump(1)
        (project / "denied.txt").unlink()
        term.prompt("RUN:touch denied.txt")
        term.pump(3)
        chat = log.read_text().splitlines()
        check("leaving yolo restores deny", not (project / "denied.txt").exists())
        check("leaving yolo restores the tools", "bash=true alias=false" in chat[-1], chat[-1])
        term.pump(1)
    term.send(SHIFT_TAB); term.wait(r"mode: auto")
    term.send(SHIFT_TAB); term.wait(r"mode: plan")
    term.send(SHIFT_TAB); term.wait(r"mode: read-only")
    term.send(SHIFT_TAB); term.wait(r"mode: normal")
    check("the cycle skips yolo", True)
    term.send(SHIFT_TAB); term.wait(r"mode: auto")
    term.send(SHIFT_TAB); term.wait(r"mode: plan")
    term.send(SHIFT_TAB); term.wait(r"mode: read-only")
    term.pump(1)
    full_text = term.text
    term.close()

    term = Terminal("--continue")
    term.wait(r"mode: read-only", 40)
    check("mode is restored when the session resumes", True)
    term.pump(1)
    ask_yolo()
    term.wait(r"Enter start")
    term.pump(0.5)
    confirm_yolo()
    term.pump(1)
    term.close()
    term = Terminal("--continue")
    term.wait(r"mode: normal", 40)
    check("yolo does not survive a resume", True)
    term.close()

    if not SOLO:
        collected = json.loads(subprocess.run(
            ["node", str(REPO / "skills/review-permissions/scripts/collect.mjs")],
            env=env, capture_output=True, text=True, check=True, timeout=20,
        ).stdout)
        examples = [e for c in collected["candidates"] for e in c.get("examples", [])]
        check("skill: finds the command a person approved", any("touch normal.txt" in e for e in examples))
        check("skill: also reads the chat history", any(c.get("ran", 0) > 0 and any("touch normal.txt" in e for e in c.get("examples", [])) for c in collected["candidates"]))
        check("skill: ignores what yolo approved", not any("yolo.txt" in e for e in examples))
        check("skill: ignores what the judge's yolo link allowed", not any("denied.txt" in e for e in examples))
        config = agent / "extensions/pi-permission-system/config.json"
        applied = subprocess.run(
            ["node", str(REPO / "skills/review-permissions/scripts/apply.mjs"), "--bash", "touch normal.txt*"],
            env=env, capture_output=True, text=True, timeout=20,
        )
        rules = json.loads(config.read_text())["permission"]["bash"]
        check("skill: applies a rule and keeps the deny after it",
              applied.returncode == 0 and list(rules) == ["*", "touch normal.txt*", "touch denied*"], str(rules))

    term = Terminal()
    term.wait(r"mode: normal", 40)
    check("a new session starts in normal", True)
finally:
    term.close()
    model.terminate()

check("no false warning about controlling the judge", "could not take control" not in full_text)
failed = [name for name, ok in checks if not ok]
print(f"\n{len(checks) - len(failed)}/{len(checks)} passed ({ORDER})")
if not failed:
    shutil.rmtree(root, ignore_errors=True)
else:
    print("kept", root)
sys.exit(1 if failed else 0)
