#!/usr/bin/env python3
"""Drives real Pi, with the real Claude Code binary, against a fake Anthropic API.

Everything lives in a throwaway home with a made-up token, so no login is used and nothing leaves
this machine. A wrapper script gives the binary the fake server's address and the token, because
the extension removes the address from what it passes on, and Claude Code only reports billing
for logins, not API keys.
"""
import fcntl, json, os, pty, re, select, shutil, signal, stat, struct, subprocess, sys, tempfile, termios, time
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
PI = REPO / "node_modules/.bin/pi"
BINARY = next((REPO / "node_modules/@anthropic-ai").glob("claude-agent-sdk-*-*/claude"))
PORT = 18000 + os.getpid() % 2000
root = Path(tempfile.mkdtemp(prefix="pi-subscription-e2e-"))
home, agent, project, log = root / "home", root / "home/.pi/agent", root / "project", root / "api.log"
agent.mkdir(parents=True)
project.mkdir()
log.touch()
wrapper = root / "claude"
wrapper.write_text(f'#!/bin/sh\nANTHROPIC_BASE_URL=http://127.0.0.1:{PORT} CLAUDE_CODE_OAUTH_TOKEN=made-up exec "{BINARY}" "$@"\n')
wrapper.chmod(wrapper.stat().st_mode | stat.S_IEXEC)
(agent / "claude-sdk.json").write_text(json.dumps({"pathToClaudeCodeExecutable": str(wrapper)}))
(agent / "settings.json").write_text(json.dumps({"defaultProvider": "claude-sdk", "defaultModel": "claude-haiku-5-5", "defaultThinkingLevel": "off", "packages": [str(REPO)]}))
(agent / "suite.json").write_text(json.dumps({"off": ["router", "web", "memory", "frame", "board", "commands"]}))
env = {"PATH": os.environ["PATH"], "HOME": str(home), "TERM": "xterm-256color", "LANG": "en_US.UTF-8", "PI_CODING_AGENT_DIR": str(agent), "PI_SKIP_VERSION_CHECK": "1", "PI_OFFLINE": "1", "CLAUDE_CONFIG_DIR": str(home / ".claude"), "ANTHROPIC_API_KEY": "must-not-arrive", "PI_CLAUDE_SDK_DEBUG": str(root / "routes.log")}
server = subprocess.Popen(["node", str(Path(__file__).parent / "fake-anthropic.mjs"), str(PORT), str(log)])
time.sleep(0.5)
ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]")
SHIFT_TAB = "\x1b[Z"
checks = []


def check(name, ok, detail=""):
    checks.append((name, ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def requests():
    return [json.loads(line) for line in log.read_text().splitlines()]


class Terminal:
    def __init__(self, *args):
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.chdir(project)
            os.execve(str(PI), [str(PI), *args], env)
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", 45, 140, 0, 0))
        self.text = ""

    def pump(self, seconds):
        end = time.time() + seconds
        while time.time() < end:
            if select.select([self.fd], [], [], 0.1)[0]:
                try:
                    self.text += ANSI.sub("", os.read(self.fd, 65536).decode("utf8", "replace"))
                except OSError:
                    return

    def wait(self, words, since=0, timeout=40):
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

    def close(self):
        try:
            os.kill(self.pid, signal.SIGKILL)
            os.waitpid(self.pid, 0)
        except OSError:
            pass


term = Terminal()
try:
    term.wait("mode: normal")
    term.pump(2)
    mark = term.prompt("hello")
    check("a request goes through the real binary and back", term.wait("OK", mark), term.text[-300:] if not requests() else "")
    sent = requests()
    names = sent[0]["names"] if sent else []
    check("pi's tools reach it through our tool server", "mcp__pi__write" in names and "mcp__pi__read" in names, str(names)[:200])
    check("Claude Code's own tools are off", not [name for name in names if not name.startswith("mcp__") and name != "DeferredToolPlaceholder"], str(names)[:200])
    check("it gets the prompt written for it", bool(sent) and sent[0]["promptSaysPi"])

    mark = term.prompt("WRITEIT")
    check("a tool call comes back to pi, and its result goes on", term.wait("FINISHED", mark))
    check("pi ran the tool", (project / "via-claude.txt").exists())

    mark = term.prompt("NATIVE")
    term.wait("FINISHED", mark, timeout=30)
    check("a tool that isn't pi's doesn't run", not (project / "native.txt").exists(), str(requests()[-1])[:200])

    (project / "via-claude.txt").unlink(missing_ok=True)
    term.send(SHIFT_TAB); term.wait("mode: auto", timeout=8)
    term.send(SHIFT_TAB); term.wait("mode: plan", timeout=8)
    term.pump(1)
    mark = term.prompt("WRITEIT")
    term.wait("FINISHED", mark)
    term.pump(1)
    check("plan mode blocks its tool calls", not (project / "via-claude.txt").exists())
    check("and the model is told", "blocks" in (requests()[-1].get("result") or "") or "plan mode" in (requests()[-1].get("result") or "").lower(), str(requests()[-1])[:220])
    term.send(SHIFT_TAB); term.wait("mode: read-only", timeout=8)
    term.pump(1)
    mark = term.prompt("WRITEIT")
    term.wait("FINISHED", mark)
    term.pump(1)
    check("read-only mode blocks them too", not (project / "via-claude.txt").exists())
    term.close()

    transcripts = list((home / ".claude/projects").rglob("*.jsonl"))
    check("Claude Code's session files stay private", bool(transcripts) and all(path.stat().st_mode & 0o077 == 0 for path in transcripts), str([oct(path.stat().st_mode) for path in transcripts][:4]))
    anchors = agent / "claude-sdk/anchors.jsonl"
    check("the anchor file is private, and in the agent directory", anchors.exists() and anchors.stat().st_mode & 0o077 == 0)

    term = Terminal()
    term.wait("mode: normal")
    term.pump(2)
    QUESTION = "Yes, bill extra usage"
    NO, YES = "\r", "\x1b[B"

    def answer_question(keys):
        term.pump(1)
        if keys == YES:
            term.send(YES)
            term.pump(0.4)
        term.send("\r")

    mark = term.prompt("BILLSLOW")
    check("a reply the report comes after is kept", term.wait("SLOWANSWER", mark, timeout=30), term.text[mark:][-300:])
    term.pump(3)
    before = len(requests())
    mark = term.prompt("BILLME")
    asked = term.wait(QUESTION, mark, timeout=15)
    check("the next request asks before sending anything", asked and len(requests()) == before, str(len(requests()) - before))
    if asked:
        answer_question(NO)
        check("saying no stops it, and sends nothing", term.wait("wasn't approved", mark, timeout=15) and len(requests()) == before)
        mark = term.prompt("BILLME")
        term.wait(QUESTION, mark, timeout=15)
        answer_question(YES)
        check("saying yes sends it", term.wait("BILLEDANSWER", mark, timeout=30), term.text[mark:][-300:])
        term.pump(1)
        mark = term.prompt("BILLME")
        check("and it doesn't ask again", term.wait("BILLEDANSWER", mark, timeout=30) and QUESTION not in term.text[mark:])
    term.close()

    (agent / "suite.json").write_text(json.dumps({"off": ["router", "web", "memory", "frame", "board", "commands", "modes", "subscription"]}))
    child = subprocess.run([str(PI), "--list-models"], env=env, cwd=project, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=60)
    check("/suite off subscription removes the models", "claude-sdk" not in child.stdout + child.stderr)
except Exception as error:
    check(f"stopped early: {error}", False)
finally:
    term.close()
    server.terminate()

failed = [name for name, ok in checks if not ok]
print(f"\n{len(checks) - len(failed)}/{len(checks)} passed")
if not failed:
    shutil.rmtree(root, ignore_errors=True)
else:
    print("kept", root)
sys.exit(1 if failed else 0)
