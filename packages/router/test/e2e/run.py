#!/usr/bin/env python3
"""Drives real Pi in a real terminal with all of pi-suite and the real permission judge."""
import fcntl, json, os, pty, re, select, shutil, signal, struct, subprocess, sys, tempfile, termios, time
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
PI = REPO / "node_modules/.bin/pi"
PORT = 22000 + os.getpid() % 2000
UP, DOWN, SHIFT_TAB, ESC = "\x1b[A", "\x1b[B", "\x1b[Z", "\x1b"

root = Path(tempfile.mkdtemp(prefix="pi-router-e2e-"))
home, agent, project, log = root / "home", root / "home/.pi/agent", root / "project", root / "requests.jsonl"
for folder in (agent / "extensions/pi-permission-system", agent / "extensions/pi-permission-classifier", project):
    folder.mkdir(parents=True)
log.touch()
(project / "AGENTS.md").write_text("Be brief.\n")
env = {"PATH": os.environ["PATH"], "HOME": str(home), "TERM": "xterm-256color", "LANG": "en_US.UTF-8", "PI_CODING_AGENT_DIR": str(agent), "PI_SKIP_VERSION_CHECK": "1"}
COST = {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}
(agent / "models.json").write_text(json.dumps({"providers": {"mock": {
    "baseUrl": f"http://127.0.0.1:{PORT}/v1", "apiKey": "unused", "api": "openai-completions",
    "models": [{"id": name, "name": name.capitalize(), "contextWindow": 100000, "maxTokens": 1000, "cost": COST} for name in ("strong", "cheap", "judge", "back", "sub")] + [
        {"id": "think", "name": "Think", "reasoning": True, "compat": {"supportsReasoningEffort": True}, "contextWindow": 100000, "maxTokens": 1000, "cost": COST},
    ],
}}}))
(agent / "extensions/pi-permission-system/config.json").write_text(json.dumps({
    "doublePressToConfirm": False, "authorizerChain": ["pi-modes", "permission-judge"],
    "permission": {"*": "allow", "bash": {"*": "ask"}, "path": {"*": "allow"}, "external_directory": "allow"},
}))
judge_file = agent / "extensions/pi-permission-classifier/config.json"
judge_file.write_text(json.dumps({"verdicts": "allow-defer"}))
(agent / "settings.json").write_text(json.dumps({
    "defaultProvider": "mock", "defaultModel": "strong", "defaultThinkingLevel": "off", "npmCommand": ["npm", "--ignore-scripts"],
    "compaction": {"keepRecentTokens": 1}, "retry": {"baseDelayMs": 100},
}))
for source in ("npm:pi-permission-classifier@0.6.0", "npm:@gotgenes/pi-permission-system@42.0.0"):
    subprocess.run([str(PI), "install", source], env=env, check=True, capture_output=True, cwd=project, timeout=240)
current = json.loads((agent / "settings.json").read_text())
current["packages"] = [str(REPO), *current.get("packages", [])]
(agent / "settings.json").write_text(json.dumps(current))
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
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", 45, 120, 0, 0))
        self.text = ""

    def pump(self, seconds):
        end = time.time() + seconds
        while time.time() < end:
            if select.select([self.fd], [], [], 0.1)[0]:
                try:
                    self.text += ANSI.sub("", os.read(self.fd, 65536).decode("utf8", "replace"))
                except OSError:
                    return

    def settle(self, seconds):
        """Up to `seconds`, done early once the screen has been still for a moment. Pi animates while it works."""
        end = time.time() + seconds
        while time.time() < end:
            seen = len(self.text)
            self.pump(0.7)
            if len(self.text) == seen:
                return

    def wait(self, words, since=0, timeout=25):
        end = time.time() + timeout
        while time.time() < end:
            self.pump(0.2)
            if words in self.text[since:]:
                return True
        return False

    def send(self, data):
        os.write(self.fd, data.encode())

    def prompt(self, text):
        mark = len(self.text)
        self.send(text)
        self.pump(0.4)
        self.send("\r")
        return mark

    def command(self, text):
        self.send(text)
        self.pump(0.4)
        self.send(ESC)
        self.pump(0.3)
        self.send("\r")
        self.settle(1)

    def redraw(self):
        """Waits for the next repaint, for a moment at most."""
        seen, end = len(self.text), time.time() + 0.3
        while len(self.text) == seen and time.time() < end:
            self.pump(0.02)
        self.pump(0.03)

    def pick(self, name):
        """Moves down a list until `name` is the marked row, then chooses it."""
        for _ in range(12):
            self.redraw()
            if re.search(r"(→|>) " + re.escape(name) + r"(\s|$)", self.text[-3000:]):
                self.send("\r")
                self.pump(0.8)
                return True
            self.send(DOWN)
        return False

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


def suite_settings():
    path = agent / "suite.json"
    return json.loads(path.read_text()) if path.exists() else {}


def router_settings():
    return suite_settings().get("router", {})


def set_off(parts):
    (agent / "suite.json").write_text(json.dumps({**suite_settings(), "off": parts}))


def set_router(value):
    (agent / "suite.json").write_text(json.dumps({**suite_settings(), "router": value}))


def requests():
    return [json.loads(line) for line in log.read_text().splitlines()]


def run_prompt(text):
    """Sends a prompt, waits for Pi to go quiet, and gives the requests it made."""
    before = len(requests())
    term.prompt(text)
    term.settle(25)
    return requests()[before:]


term = Terminal()
try:
    check("starts", term.wait("Strong", timeout=40))
    term.settle(2)
    term.command("/model router/auto")
    check("router/auto can be selected with nothing set", term.wait("has no models yet", timeout=10))
    before = len(requests())
    mark = term.prompt("hello")
    check("with nothing set, it says to run /router, and calls nothing", term.wait("Run /router", mark, timeout=10) and len(requests()) == before)
    term.command("/model mock/strong")
    term.settle(1)
    term.command("/router")
    check("/router opens, with nothing set", term.wait("Router: which role", timeout=8) and "plan: not set" in term.text)
    for role, chosen in (("plan", "strong"), ("build", "cheap"), ("reader", "cheap"), ("judge", "judge"), ("subagent", "sub"), ("fallback", "back")):
        ok = term.pick(f"{role}:") and term.pick(f"mock/{chosen}")
        check(f"/router sets {role}", ok)
        term.pump(0.5)
    term.send(ESC)
    term.settle(1)
    saved = router_settings()
    check("the choices are saved", saved.get("plan") == "mock/strong" and saved.get("build") == "mock/cheap" and saved.get("fallback") == "mock/back" and "judge" not in saved, str(saved))
    judge = json.loads(judge_file.read_text())
    check("the judge's own settings get its model, and keep the rest", judge == {"verdicts": "allow-defer", "provider": "mock", "model": "judge"}, str(judge))

    current = json.loads((agent / "settings.json").read_text())
    current.update(defaultProvider="router", defaultModel="auto")
    (agent / "settings.json").write_text(json.dumps(current))
    term.close()
    term = Terminal()
    check("router/auto can be the default", term.wait("Auto", timeout=40))
    term.pump(2)
    check("no warning once the judge has a model", "permission judge has no model" not in term.text)

    sent = run_prompt("hello")
    check("a new session starts on the plan model", [r["model"] for r in sent] == ["strong"], str(sent))
    check("the frame shows who answered", "Auto → Strong" in term.text)
    sent = run_prompt("READ")
    check("reading stays on the plan model", all(r["model"] == "strong" for r in sent), str(sent))
    sent = run_prompt("WRITE")
    check("the first edit moves to the build model", [r["model"] for r in sent] == ["strong", "cheap"], str([r["model"] for r in sent]))
    check("the file was written", (project / "made.txt").exists())
    term.settle(1)
    check("the frame shows the change", "Auto → Cheap" in term.text)
    sent = run_prompt("hello again")
    check("building lasts into the next message", [r["model"] for r in sent] == ["cheap"], str(sent))

    term.send(SHIFT_TAB)
    term.wait("mode: auto", len(term.text) - 2000, 5)
    term.pump(0.5)
    sent = run_prompt("RUN")
    judged = [r["model"] for r in sent if r["judge"]]
    check("the judge decides on its own model", judged == ["judge"], str(sent))
    check("the judge's decision took effect", (project / "judged.txt").exists())
    check("the agent stays on the build model", all(r["model"] == "cheap" for r in sent if not r["judge"]), str(sent))

    term.send(SHIFT_TAB)
    term.wait("mode: plan", len(term.text) - 2000, 5)
    term.pump(0.5)
    sent = run_prompt("think about it")
    check("plan mode uses the plan model", [r["model"] for r in sent] == ["strong"], str(sent))
    mark = term.prompt("PLAN")
    check("the plan asks for approval", term.wait("Approve this plan", mark))
    term.pump(0.5)
    before = len(requests())
    term.send("\r")
    term.settle(3)
    after = [r["model"] for r in requests()[before:]]
    check("an approved plan moves to the build model at once", after == ["cheap"], str(after))

    sent = run_prompt("OVERLOAD")
    models = [r["model"] for r in sent]
    check("an overloaded provider moves to the fallback", models[0] == "cheap" and models[-1] == "back", str(models))
    sent = run_prompt("hello once more")
    check("the next message tries the first choice again", [r["model"] for r in sent] == ["cheap"], str(sent))

    before = len(requests())
    term.command("/compact")
    term.settle(4)
    after = requests()[before:]
    check("compaction uses the build model", bool(after) and all(r["model"] == "cheap" for r in after), str(after))
    term.close()

    before = len(requests())
    child = subprocess.run([str(PI), "-p", "hello"], env={**env, "PI_SUBAGENT_CHILD": "1"}, cwd=project, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=60)
    after = [r["model"] for r in requests()[before:]]
    check("a subagent uses its own model", after == ["sub"], f"{after} {child.stderr[-200:]}")

    term = Terminal()
    term.wait("Auto", timeout=40)
    term.settle(2)
    run_prompt("before turning it off")
    mark = len(term.text)
    term.command("/suite off router")
    term.wait("Reload Pi now", mark, 8)
    term.pump(0.3)
    term.send("\r")
    term.settle(6)
    before = len(requests())
    mark = len(term.text)
    run_prompt("after turning it off")
    check("after /suite off router, a session carries on with the model that last answered", [r["model"] for r in requests()[before:]] == ["strong"] and "stale" not in term.text[mark:], str(requests()[before:]) + term.text[mark:][-200:])
    term.close()
    set_off([])
    term = Terminal()
    term.wait("Auto", timeout=40)
    term.settle(2)
    term.command("/new")
    term.settle(3)
    sent = run_prompt("hello in a new session")
    check("router/auto still works after /new", [r["model"] for r in sent] == ["strong"], str(sent))
    term.close()

    current = json.loads((agent / "settings.json").read_text())
    saved_before = (current.get("defaultProvider"), current.get("defaultModel"))
    current["hideThinkingBlock"] = True
    (agent / "settings.json").write_text(json.dumps(current))
    term = Terminal("--model", "mock/think", "--thinking", "high")
    term.wait("Think", timeout=40)
    term.settle(2)
    run_prompt("hello before clear")
    term.command("/clear")
    term.settle(3)
    sent = run_prompt("hello after clear")
    check("/clear keeps the model and the reasoning", [(r["model"], r.get("effort")) for r in sent] == [("think", "high")], str(sent))
    current = json.loads((agent / "settings.json").read_text())
    check("/clear doesn't change the saved default", (current.get("defaultProvider"), current.get("defaultModel")) == saved_before)

    mark = term.prompt("THINK")
    check("reasoning shows while it's written", term.wait("SECRETPLAN", mark, timeout=10))
    check("it collapses once done", term.wait("Thought · ctrl+t to expand", mark, timeout=10))
    term.settle(1)
    mark = len(term.text)
    term.send("\x14")
    check("ctrl+t opens it again", term.wait("SECRETPLAN", mark, timeout=8))
    term.send("\x14")
    term.settle(1)

    mark = len(term.text)
    term.send("hello a")
    term.pump(0.5)
    term.send("\x1b[A")
    check("Up with text finds an older prompt that starts with it", term.wait("hello after clear", mark, timeout=5))
    mark = len(term.text)
    term.send("\x1b[B")
    check("Down comes back to what was typed", term.wait("hello a", mark, timeout=5))
    term.send("\x15")
    term.pump(0.5)
    mark = len(term.text)
    term.send("\x12")
    check("ctrl+r opens the search", term.wait("search history:", mark, timeout=5) and "Rename" not in term.text[mark:], term.text[mark:][-200:])
    term.send("before")
    check("ctrl+r finds what's typed anywhere in a prompt, from this folder's other sessions", term.wait("hello before clear", mark, timeout=5))
    term.send(ESC)
    term.pump(0.5)
    term.close()
    term = Terminal()
    term.wait("Auto", timeout=40)
    term.settle(2)
    mark = len(term.text)
    term.send("\x1b[A")
    check("Up in a new Pi reaches what was typed before", term.wait("THINK", mark, timeout=5) or term.wait("hello after clear", mark, timeout=1))
    term.send("\x1b[B")
    term.pump(0.5)

    plain = router_settings()
    term.command("/router")
    term.wait("Router: which role", timeout=8)
    ok = term.pick("plan:") and term.pick("mock/think")
    check("choosing a model asks for its reasoning", ok and term.wait("Reasoning for plan on mock/think", timeout=8))
    check("it offers what the model can do", term.pick("high"))
    term.settle(1)
    check("the row shows it", "· high" in term.text[-3000:])
    term.send(ESC)
    term.settle(1)
    check("the level is saved", router_settings().get("thinking") == {"plan": "high"})
    term.command("/model router/auto")
    term.settle(1)
    term.command("/new")
    term.settle(3)
    term.command("/model router/auto")
    term.settle(1)
    sent = run_prompt("hello with reasoning")
    check("the plan role uses its own level", [(r["model"], r.get("effort")) for r in sent] == [("think", "high")], str(sent))
    term.close()
    set_router(plain)

    term = Terminal()
    term.wait("Auto", timeout=40)
    term.settle(2)
    mark = len(term.text)
    term.command("/mastermind")
    check("/mastermind asks for a model first", term.wait("set mastermind in /router", mark, 8))
    term.close()
    set_router({**plain, "mastermind": "mock/strong"})
    term = Terminal()
    term.wait("Auto", timeout=40)
    term.settle(2)
    before = len(requests())
    mark = len(term.text)
    term.command("/mastermind")
    check("it offers what the strong model wrote", term.wait("It has rules for global", mark, 20), term.text[mark:][-300:])
    asked = requests()[before:]
    check("the strong model gets it, without the session's tools", [r["model"] for r in asked] == ["strong"] and asked[0]["tools"] == 0, str(asked))
    check("the review reads past conversations", asked[0]["carried"], str(asked))
    term.send("\r")
    check("the rules open in an editor", term.wait("Delete what you don't want", mark, 8))
    check("nothing is saved until you do", not list((agent / "memory/playbook").glob("*")) if (agent / "memory/playbook").exists() else True)
    term.pump(0.3)
    term.send("\r")
    term.wait("Keep going", mark, 8)
    term.settle(1)
    if "Keep going" in term.text[mark:]:
        term.send(ESC)
        term.settle(1)
    saved_rules = [path.read_text() for path in (agent / "memory/playbook").glob("*.md")]
    check("your approval saves them", saved_rules == ["- Always run the tests.\n"], str(saved_rules))
    sent = run_prompt("hello with rules")
    check("the next message has the rules", bool(sent) and all(r["rules"] for r in sent), str(sent))
    check("and none of what the review read", not any(r["carried"] for r in sent), str(sent))
    term.command("/model mock/strong")
    term.settle(1)
    sent = run_prompt("hello as the mastermind")
    check("the mastermind itself goes without them", bool(sent) and not any(r["rules"] for r in sent), str(sent))
    mark = len(term.text)
    term.command("/mastermind compact")
    check("compact offers a shorter version", term.wait("Delete what you don't want", mark, 20))
    term.send(ESC)
    term.settle(1)
    saved_rules = [path.read_text() for path in (agent / "memory/playbook").glob("*.md")]
    check("escape leaves it as it was", saved_rules == ["- Always run the tests.\n"], str(saved_rules))
    term.close()
    set_router(plain)

    term = Terminal()
    term.wait("Auto", timeout=40)
    term.settle(2)
    before = len(requests())
    answered = lambda: any("CHILD-ANSWER" in r["tail"] for r in requests()[before:])
    def until_answered():
        end = time.time() + 40
        while not answered() and time.time() < end:
            term.pump(0.3)
        term.settle(2)
    term.prompt("AGENTREAD")
    until_answered()
    sent = requests()[before:]
    child = next((r for r in sent if "CHILDREAD" in r["text"]), None)
    check("an agent runs on the subagent role, with only read tools", bool(child) and child["model"] == "sub" and child["tools"] == 4, str(sent))
    check("its answer comes back to the parent", any("CHILD-ANSWER" in r["tail"] for r in sent), str(sent))
    before = len(requests())
    mark = term.prompt("AGENTWRITE")
    term.wait("FINISHED", mark, 40)
    term.settle(2)
    check("a general agent can write", (project / "from-child.txt").exists(), term.text[mark:][-300:])
    term.send(SHIFT_TAB)
    term.send(SHIFT_TAB)
    term.wait("mode: plan", len(term.text) - 2000, 5)
    mark = term.prompt("AGENTWRITE")
    check("plan mode blocks a general agent", term.wait("blocks agent", mark, 10), term.text[mark:][-300:])
    before = len(requests())
    term.prompt("AGENTREAD")
    until_answered()
    check("and allows an explore agent", answered(), str(requests()[before:]))
    term.close()

    judge_file.write_text("{}")
    term = Terminal()
    check("router/auto warns when the judge has no model of its own", term.wait("permission judge has no model", timeout=30))
    term.close()

    set_router({"planner": "mock/strong"})
    term = Terminal()
    check("broken router settings say so", term.wait("pi-router is off", timeout=30))
    term.close()
    before = len(requests())
    child = subprocess.run([str(PI), "-p", "hello"], env=env, cwd=project, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=60)
    check("with it broken, router/auto stops rather than using another model", "pi-router is off" in child.stdout + child.stderr and len(requests()) == before, (child.stdout + child.stderr)[-200:])
    set_router({"plan": "mock/nonexistent", "build": "mock/cheap"})
    before = len(requests())
    child = subprocess.run([str(PI), "-p", "hello"], env=env, cwd=project, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=60)
    check("a model that doesn't exist fails with a clear message, and calls nothing", "mock/nonexistent" in child.stdout + child.stderr and len(requests()) == before, (child.stdout + child.stderr)[-200:])
except Exception as error:  # A check that can't finish is a failure, and the rest of the report still helps.
    check(f"stopped early: {error}", False)
finally:
    term.close()
    model.terminate()

failed = [name for name, ok in checks if not ok]
print(f"\n{len(checks) - len(failed)}/{len(checks)} passed")
if failed:
    print("kept", root)
    Path(root / "screen.txt").write_text(term.text)
else:
    shutil.rmtree(root, ignore_errors=True)
sys.exit(1 if failed else 0)
