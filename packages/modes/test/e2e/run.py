#!/usr/bin/env python3
"""Drives real Pi in a real terminal with a fake model.

Usage: run.py <solo|modes-first|modes-last|classifier-last|sandbox>

  solo         only this extension
  modes-first  your five extensions, with this one loaded first
  modes-last   your five extensions, with this one loaded last
  classifier-last  this one first, and the classifier after the permission system
  sandbox      this one first, then the permission system, the classifier and pi-sandbox.
               Needs ripgrep on PATH.

Everything lives in a throwaway home directory, so no real credentials are used.
The modes-* runs install the third-party packages from npm with scripts disabled
and start them, so run those yourself.
"""
import fcntl, json, os, pty, re, select, shutil, signal, struct, subprocess, sys, tempfile, termios, time
from pathlib import Path

ORDER = sys.argv[1]
SOLO = ORDER == "solo"
REPO = Path(__file__).resolve().parents[4]
PI = REPO / "node_modules/.bin/pi"
THIRD_PARTY = [] if SOLO else [
    "npm:pi-permission-classifier@0.6.0",
    "npm:@gotgenes/pi-permission-system@42.0.0",
    "npm:pi-subagents@0.84.0",
    "npm:pi-claude-code-ui@1.0.107",
    "npm:@adeildo/pi-look@6.0.0",
]
if ORDER == "sandbox":
    THIRD_PARTY = [*THIRD_PARTY[:2], "npm:pi-sandbox@0.7.3"]
if ORDER == "classifier-last":
    THIRD_PARTY[0], THIRD_PARTY[1] = THIRD_PARTY[1], THIRD_PARTY[0]
PORT = 18000 + os.getpid() % 2000
root = Path(tempfile.mkdtemp(prefix="pi-modes-e2e-"))
home, agent, project = root / "home", root / "home/.pi/agent", root / "project"
(agent / "extensions/pi-permission-system").mkdir(parents=True)
(agent / "extensions/pi-permission-classifier").mkdir(parents=True)
project.mkdir()
outside = root / "outside"
outside.mkdir()
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
    "permission": {"*": "ask", "bash": {"*": "ask", "touch incd*": "allow", "touch denied*": "deny"}, "path": {"*": "allow", "*.secret": "deny"}, "read": "allow", "submit_plan": "allow", "external_directory": {"*": "allow", str(outside): "ask", f"{outside}/*": "ask"}},
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
# Only the parts under test, and they all load from the suite's one entry.
WITH_FRAME = bool(os.environ.get("PI_MODES_E2E_FRAME"))
parts = ["modes", "frame"] if WITH_FRAME else ["modes"]
(agent / "suite.json").write_text(json.dumps({"off": [part for part in ("router", "web", "memory", "frame", "board") if part not in parts]}))
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

    def settle(self, seconds):
        """Up to `seconds`, done early once the screen has been still for a moment. Pi animates while it works."""
        end = time.time() + seconds
        while time.time() < end:
            seen = len(self.text)
            self.pump(0.7)
            if len(self.text) == seen:
                return

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


def log_results():
    path = Path(f"{log}.results")
    return path.read_text() if path.exists() else ""


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
    term.settle(1)
    # pi-look keeps its footer drawing for 100 ms, so a key makes it show the new mode.
    term.send(" ")
    term.pump(0.2)
    term.send("\x7f")
    term.wait(r"mode: yolo")


def approve_dialog_if_first():
    if DIALOG_FIRST:
        term.settle(2)
        term.send("y")


class SandboxRunDone(Exception):
    pass


term = Terminal()
try:
    term.wait(r"mode: normal", 40)
    term.settle(1.5)
    check("footer shows the mode", True)
    if SOLO:
        UP, DOWN = "\x1b[A", "\x1b[B"
        term.prompt("ASK")
        term.wait("Which database")
        check("interview: the question opens", True)
        check("interview: its text can't drive the terminal", "\\u001b]0;ASKTITLE" in term.text)
        term.send("\r")
        term.wait("Add tests")
        term.send(DOWN + "\r")
        term.wait("Which targets")
        term.pump(0.5)
        term.send(" ")
        term.send(DOWN)
        term.send(DOWN)
        term.send(" ")
        term.pump(0.5)
        term.send("\r")
        term.wait("Anything else")
        term.pump(0.5)
        term.send("ship friday\r")
        term.wait("FINISHED")
        term.settle(1)
        shown = re.sub(r"\s+", " ", term.text[term.text.rindex("FINISHED"):])
        check("interview: the model gets each answer", all(part in shown for part in ("A: Postgres", "A: No", 'A: ["web","android"]', "A: ship friday")), shown[:300])
        mark = len(term.text)
        term.prompt("ASK")
        term.until(lambda: "Which database" in term.text[mark:], "the question")
        term.pump(0.5)
        term.send(DOWN + DOWN + "\r")
        term.settle(1)
        term.send("MariaDB\r")
        term.until(lambda: "Add tests" in term.text[mark:], "the second question")
        term.pump(0.5)
        term.send("\x1b")
        term.until(lambda: "FINISHED" in term.text[mark:], "the model's answer")
        term.settle(1)
        shown = re.sub(r"\s+", " ", term.text[mark:])
        check("interview: an answer of your own reaches the model", "A: MariaDB" in shown, shown[-300:])
        check("interview: esc stops the rest and says not to guess", "closed the questions at: Add tests" in shown and "(3/4)" not in shown)
        mark = len(term.text)
        term.prompt("ASKBAD")
        term.until(lambda: "2 to 10" in term.text[mark:], "the refusal")
        check("interview: a bad call goes back to the model, not to the user", True)
        term.settle(2)
        check("interview: a dialog says who is asking", "Agent question 1/4" in term.text)
        term.send("\x1b[Z")
        term.until(lambda: "mode: auto" in term.text, "auto")
        term.settle(1)
        term.send("\x1b[Z")
        term.until(lambda: "mode: plan" in term.text, "plan")
        term.settle(1)
        mark = len(term.text)
        term.prompt("ASK")
        term.until(lambda: "Which database" in term.text[mark:], "the question in plan mode")
        check("interview: plan mode allows it", "blocks ask_questions" not in term.text[mark:])
        term.pump(0.5)
        term.send("\x1b")
        term.until(lambda: "FINISHED" in term.text[mark:], "plan mode's answer")
        term.settle(1)
        for _ in range(2):
            term.send("\x1b[Z")
            term.settle(1)
    if not SOLO and ORDER != "sandbox":
        mark = len(term.text)
        term.prompt("ASK")
        term.settle(4)
        asked_first = "Which database" not in term.text[mark:].split("Agent question")[-1] or "Agent question" not in term.text[mark:]
        if "Agent question" not in term.text[mark:]:
            term.send("y")
        term.until(lambda: "Agent question 1/4" in term.text[mark:], "the interview beside the permission system", 15)
        check("interview: works beside the permission system, which asks first with * set to ask", asked_first)
        term.pump(0.5)
        term.send("\x1b")
        term.until(lambda: "FINISHED" in term.text[mark:], "the closed interview")
        term.settle(1)
    if ORDER == "sandbox":
        outside = home / "outside.txt"
        term.prompt("RUN:touch inside.txt")
        term.settle(3)
        term.send("y")
        term.wait("FINISHED", 15)
        check("sandbox: a command in the project runs", (project / "inside.txt").exists())
        (project / "box").mkdir()
        term.prompt("RUN:cd box && touch incd-boxed.txt")
        term.settle(5)
        term.prompt("RUN:touch incd-boxed2.txt")
        term.settle(5)
        where = sorted(str(path.relative_to(project)) for path in project.rglob("incd-boxed*.txt"))
        check("sandbox: the folder carries over inside it", where == ["box/incd-boxed.txt", "box/incd-boxed2.txt"], str(where))
        term.prompt(f"RUN:cd {project}")
        term.settle(5)
        ask_yolo()
        term.wait("YOLO")
        term.pump(0.5)
        check("sandbox: yolo says it stays inside", "inside the sandbox" in term.text)
        check("sandbox: no way to ignore deny rules", "ignore deny rules" not in term.text)
        term.send("d")
        term.pump(0.5)
        check("sandbox: d does nothing", "IGNORED" not in term.text)
        confirm_yolo()
        check("sandbox: yolo starts", True)
        mark = len(term.text)
        term.prompt(f"RUN:touch {outside}")
        term.until(lambda: "FINISHED" in term.text[mark:], "result", 20)
        check("sandbox: yolo runs without a prompt", True)
        check("sandbox: yolo can't write outside", not outside.exists())
        mark = len(term.text)
        term.prompt("RUN:touch denied.txt")
        term.until(lambda: "FINISHED" in term.text[mark:], "result", 20)
        check("sandbox: yolo keeps deny rules", not (project / "denied.txt").exists())
        term.send("\x1bs")
        term.wait("Sandbox disabled", 10)
        term.settle(1)
        if WITH_FRAME:
            check("sandbox: pi-frame shows it off", "sandbox: off" in term.text[mark:])
        term.prompt("RUN:touch after-off.txt")
        term.wait("yolo ended", 15)
        term.pump(2)
        check("sandbox: with it off, yolo ends instead of running", not (project / "after-off.txt").exists())
        mark = len(term.text)
        ask_yolo()
        term.wait("only runs inside the sandbox", 10)
        check("sandbox: yolo is refused while it's off", True)
        term.send("\x1bs")
        term.wait("Sandbox enabled", 10)
        term.settle(1)
        # Enter would pick the first choice, which allows it. Esc keeps it blocked.
        elsewhere = REPO / "README.md"
        # The permission system asks about the last two first, and the sandbox only sees what it lets by.
        for prompt, asks in ((f"READ:{elsewhere}", False), (f"WRITE:{outside}", True), ("RUN:curl -s https://blocked.example.test/x", True)):
            mark = len(term.text)
            term.prompt(prompt)
            term.settle(3)
            if asks:
                term.send("y")
                term.settle(3)
            term.send("\x1b")
            term.until(lambda: "FINISHED" in term.text[mark:], "result", 25)
        check("sandbox: a refused write stays out", not outside.exists())
        collected = subprocess.run(["node", str(Path(__file__).parent / "review-cli.mjs"), "collect"], env=env, capture_output=True, text=True, timeout=30)
        sandbox = json.loads(collected.stdout)["sandbox"]
        found = {(c["kind"], c["value"]) for c in sandbox["candidates"]}
        for kind, value in (("read", str(elsewhere)), ("write", str(outside)), ("domain", "blocked.example.test")):
            check(f"skill: sees the blocked {kind}", any(k == kind and (value in v or v in value) for k, v in found), str(sandbox))
        check("skill: counts what the OS stopped", sandbox["osBlocks"] >= 1 and "Operation not permitted" in sandbox["osExamples"][0], str(sandbox))
        folder = str(project / "sibling")
        applied = subprocess.run(["node", str(Path(__file__).parent / "review-cli.mjs"), "apply", "--sandbox-read", folder, "--sandbox-domain", "pkg.example.test"], env=env, capture_output=True, text=True, timeout=30)
        written = json.loads((agent / "sandbox.json").read_text())
        check("skill: allows choices in sandbox.json and keeps the defaults", applied.returncode == 0 and folder in written["filesystem"]["allowRead"] and "." in written["filesystem"]["allowRead"] and "github.com" in written["network"]["allowedDomains"], applied.stderr)
        refused = subprocess.run(["node", str(Path(__file__).parent / "review-cli.mjs"), "apply", "--sandbox-read", "~/.ssh"], env=env, capture_output=True, text=True, timeout=30)
        check("skill: refuses credentials", refused.returncode == 1 and "credentials" in refused.stderr)
        full_text = term.text
        raise SandboxRunDone
    if not SOLO:
        term.send(SHIFT_TAB)
        term.wait(r"mode: auto")
        term.pump(1.5)
        check("auto: no false warning before the first prompt", "Auto has no permission judge" not in term.text)
        for name in ("plan", "read-only", "normal"):
            term.send(SHIFT_TAB)
            term.wait(f"mode: {name}")
        term.settle(1)
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
        term.settle(1)
        mark = len(term.text)
        term.prompt("AGENT:from-agent.txt")
        check("an agent's ask comes to your session", term.wait(r"for 'from-agent\.txt'", 30) and not (project / "from-agent.txt").exists(), term.text[mark:][-300:])
        term.pump(0.5)
        term.send("\r")
        term.until((project / "from-agent.txt").exists, "from-agent.txt", 30)
        check("and approving it lets the agent write", True)
    term.settle(1)

    term.send(SHIFT_TAB)
    term.wait(r"mode: auto")
    check("shift+tab switches to auto", True)
    if SOLO:
        term.settle(1)
        check("auto warns when no judge is installed", "Auto has no permission judge" in term.text)
    else:
        term.prompt("RUN:touch auto.txt")
        term.until((project / "auto.txt").exists, "auto.txt")
        check("auto: judge decides and the command runs without a prompt", judge_calls() == 1, f"judge={judge_calls()}")
        term.settle(1)
        term.prompt("WRITE:auto-edit.txt")
        term.until((project / "auto-edit.txt").exists, "auto-edit.txt")
        check("auto: a file in the project is written without the judge or a prompt", judge_calls() == 1, f"judge={judge_calls()}")
        term.settle(1)
        term.prompt("WRITE:.husky/auto-hook")
        term.until((project / ".husky/auto-hook").exists, "auto-hook")
        check("auto: a guarded folder still goes to the judge", judge_calls() == 2, f"judge={judge_calls()}")
        term.settle(1)
        (project / "sub/deep").mkdir(parents=True)
        def ran(command, where):
            term.settle(1)
            term.prompt(f"RUN:{command}")
            term.until((project / where).exists, where)
        ran("cd sub/deep && touch incd.txt", "sub/deep/incd.txt")
        check("cd: the rule was added for you, so moving asks nobody", judge_calls() == 2, f"judge={judge_calls()}")
        ran("touch incd2.txt", "sub/deep/incd2.txt")
        check("cd: the folder carries over to the next command, and the model is told", "Bash stays in" in log_results(), log_results()[-200:])
        ran("cd sub/deep && touch incd3.txt", "sub/deep/incd3.txt")
        check("cd: repeating a move doesn't fail", True)
        ran("cd .. && touch incd4.txt", "sub/incd4.txt")
        check("cd: a relative move starts from there", ORDER == "modes-last" or judge_calls() == 2, f"judge={judge_calls()}")
        term.settle(1)
        asked_before = judge_calls()
        term.prompt(f"RUN:cd {outside} && touch incd-out.txt")
        approve_dialog_if_first()
        term.until((outside / "incd-out.txt").exists, "incd-out.txt")
        check("cd: a move outside the project is still gated", DIALOG_FIRST or judge_calls() == asked_before + 1, f"judge={judge_calls()}")
        term.settle(1)
        check("cd: leaving the project says it was reset", "Shell cwd was reset" in log_results(), log_results()[-200:])
        ran("touch incd5.txt", "incd5.txt")
        check("cd: and the next command runs at the top", True)
    term.settle(1)

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
    term.settle(1)

    term.prompt("RUN:touch planask.txt")
    approve_dialog_if_first()
    term.wait(r"Plan mode: run this command")
    term.pump(0.5)
    term.send("\x1b")
    term.wait(r"Plan mode blocked this command")
    check("plan: declining a command blocks it", not (project / "planask.txt").exists())
    term.settle(1)

    term.prompt("PLAN")
    term.wait(r"Approve this plan")
    check("plan: the plan is shown before approval", "PLANBODY" in term.text)
    term.pump(0.5)
    term.send("\r")
    term.wait(r"approved the plan and switched to normal")
    term.wait(r"mode: normal")
    check("approving the plan returns to normal", True)
    term.settle(1)

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
    term.settle(1)
    term.prompt("RUN:echo READONLY_OK")
    if not SOLO:
        term.settle(2)
        term.send("y")
    term.wait(r"FINISHED READONLY_OK")
    check("read-only: read-only bash runs", True)
    term.settle(1)
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
    term.settle(1)
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
        term.settle(1)
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
        term.settle(1)
        term.prompt("WRITE:deny.secret")
        term.until((project / "deny.secret").exists, "deny.secret")
        check("deny off: a denied path can be written", True)
        chat = log.read_text().splitlines()
        check("deny off: the model gets the other tools instead of bash", "bash=false alias=true" in chat[-1], chat[-1])
        term.settle(1)
        term.send(SHIFT_TAB)
        term.wait(r"mode: normal")
        term.settle(1)
        (project / "denied.txt").unlink()
        term.prompt("RUN:touch denied.txt")
        term.pump(3)
        chat = log.read_text().splitlines()
        check("leaving yolo restores deny", not (project / "denied.txt").exists())
        check("leaving yolo restores the tools", "bash=true alias=false" in chat[-1], chat[-1])
        term.settle(1)
    term.send(SHIFT_TAB); term.wait(r"mode: auto")
    term.send(SHIFT_TAB); term.wait(r"mode: plan")
    term.send(SHIFT_TAB); term.wait(r"mode: read-only")
    term.send(SHIFT_TAB); term.wait(r"mode: normal")
    check("the cycle skips yolo", True)
    term.send(SHIFT_TAB); term.wait(r"mode: auto")
    term.send(SHIFT_TAB); term.wait(r"mode: plan")
    term.send(SHIFT_TAB); term.wait(r"mode: read-only")
    term.settle(1)
    full_text = term.text
    term.close()

    term = Terminal("--continue")
    term.wait(r"mode: read-only", 40)
    check("mode is restored when the session resumes", True)
    term.settle(1)
    ask_yolo()
    term.wait(r"Enter start")
    term.pump(0.5)
    confirm_yolo()
    term.settle(1)
    term.close()
    term = Terminal("--continue")
    term.wait(r"mode: normal", 40)
    check("yolo does not survive a resume", True)
    term.close()

    if not SOLO:
        collected = json.loads(subprocess.run(
            ["node", str(Path(__file__).parent / "review-cli.mjs"), "collect"],
            env=env, capture_output=True, text=True, check=True, timeout=20,
        ).stdout)
        examples = [e for c in collected["candidates"] for e in c.get("examples", [])]
        check("skill: finds the command a person approved", any("touch normal.txt" in e for e in examples))
        check("skill: also reads the chat history", any(c.get("ran", 0) > 0 and any("touch normal.txt" in e for e in c.get("examples", [])) for c in collected["candidates"]))
        check("skill: ignores what yolo approved", not any("yolo.txt" in e for e in examples))
        check("skill: ignores what the judge's yolo link allowed", not any("denied.txt" in e for e in examples))
        config = agent / "extensions/pi-permission-system/config.json"
        applied = subprocess.run(
            ["node", str(Path(__file__).parent / "review-cli.mjs"), "apply", "--bash", "touch normal.txt*"],
            env=env, capture_output=True, text=True, timeout=20,
        )
        rules = json.loads(config.read_text())["permission"]["bash"]
        check("skill: applies a rule and keeps the deny after it",
              applied.returncode == 0 and [rule for rule in rules if not rule.startswith("cd ")] == ["*", "touch normal.txt*", "touch incd*", "touch denied*"] and list(rules)[-1] == "touch denied*", str(rules))

    term = Terminal()
    term.wait(r"mode: normal", 40)
    check("a new session starts in normal", True)

    if SOLO:
        config = agent / "extensions/pi-permission-system/config.json"
        before = config.read_text()
        term.prompt("APPLY:npm test*")
        term.wait(r"Add these permission rules", 15)
        check("skill: the tool asks, and shows the rule", "npm test*" in term.text)
        term.send("\x1b")
        term.until(lambda: "declined" in term.text or "FINISHED" in term.text, "the answer", 15)
        term.pump(1)
        check("skill: declining changes nothing", config.read_text() == before)
        mark = len(term.text)
        term.prompt("APPLY:npm test*")
        term.until(lambda: "Add these permission rules" in term.text[mark:], "the second question", 15)
        term.send("\r")
        term.until(lambda: "FINISHED" in term.text[mark:], "the result", 15)
        check("skill: agreeing adds the rule", "npm test*" in json.loads(config.read_text())["permission"]["bash"])

    term.close()
    (project / "seen.txt").write_text("SCRIPTSAW")
    # So only the modes and the deny rules decide, with no dialogs.
    config = agent / "extensions/pi-permission-system/config.json"
    rules = json.loads(config.read_text())
    rules["permission"].update({"codemode": "allow", "write": "allow", "bash": {"*": "allow", "touch denied*": "deny"}})
    config.write_text(json.dumps(rules))
    term = Terminal("--tools", "+codemode")
    term.wait(r"mode: normal", 40)

    def script(code):
        """What the model got back. A UI extension can hide script output from the screen."""
        results = Path(f"{log}.results")
        mark, before = len(term.text), len(results.read_text()) if results.exists() else 0
        term.prompt(f"CODE:{code}")
        term.until(lambda: "FINISHED" in term.text[mark:], "the script's result", 25)
        term.pump(0.5)
        return results.read_text()[before:]

    def writes(name):
        return f'return await tools.write({{path:"{name}",content:"x"}})'

    READS = 'return await tools.read({path:"seen.txt"})'
    TOUCHES = 'return await tools.bash({command:"touch scripted-bash.txt"})'
    check("codemode: a script reads in normal", "SCRIPTSAW" in script(READS))
    if not SOLO:
        (project / "hidden.secret").write_text("TOPSECRET")
        check("codemode: a deny rule stops a script", "TOPSECRET" not in script('return await tools.read({path:"hidden.secret"})'))
    script(writes("scripted-normal.txt"))
    check("codemode: a script can't write in normal", not (project / "scripted-normal.txt").exists())
    script(TOUCHES)
    check("codemode: a script can't run changing bash in normal", not (project / "scripted-bash.txt").exists())
    listed = script('return await tools.bash({command:"ls"})')
    check("codemode: a script runs read-only bash", "seen.txt" in listed, listed)
    term.send(SHIFT_TAB); term.wait(r"mode: auto")
    term.send(SHIFT_TAB); term.wait(r"mode: plan")
    check("codemode: a script reads in plan", "SCRIPTSAW" in script(READS))
    script(writes("scripted-plan.txt"))
    check("codemode: a script can't write in plan", not (project / "scripted-plan.txt").exists())
    term.send(SHIFT_TAB); term.wait(r"mode: read-only")
    check("codemode: a script reads in read-only", "SCRIPTSAW" in script(READS))
    script(writes("scripted-readonly.txt"))
    check("codemode: a script can't write in read-only", not (project / "scripted-readonly.txt").exists())
    term.close()
    current = json.loads((agent / "settings.json").read_text())
    (agent / "settings.json").write_text(json.dumps({**current, "codemode": {"mode": "only"}}))
    term = Terminal("--tools", "+codemode")
    term.wait(r"mode: normal", 40)
    script(writes("scripted-only.txt"))
    check("codemode: with mode only, a script can write in normal", (project / "scripted-only.txt").exists())
    term.send(SHIFT_TAB); term.wait(r"mode: auto")
    term.send(SHIFT_TAB); term.wait(r"mode: plan")
    script(writes("scripted-only-plan.txt"))
    check("codemode: with mode only, plan still blocks a script's write", not (project / "scripted-only-plan.txt").exists())
except SandboxRunDone:
    pass
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
