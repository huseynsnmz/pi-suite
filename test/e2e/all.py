#!/usr/bin/env python3
"""Runs every end-to-end suite at once, and shows the output of the ones that fail. Names to run only some: all.py router web"""
import subprocess, sys, tempfile, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
MODES = "packages/modes/test/e2e/run.py"
SUITES = {
    "suite": ["python3", "test/e2e/run.py"],
    "frame": ["python3", "packages/frame/test/e2e/run.py"],
    "router": ["python3", "packages/router/test/e2e/run.py"],
    "web": ["node", "packages/web/test/e2e/run.mjs"],
    "subscription": ["python3", "packages/subscription/test/e2e/run.py"],
    "modes-solo": ["python3", MODES, "solo"],
    "modes-first": ["python3", MODES, "modes-first"],
    "modes-last": ["python3", MODES, "modes-last"],
    "classifier-last": ["python3", MODES, "classifier-last"],
    "modes-sandbox": ["python3", MODES, "sandbox"],
}
wanted = sys.argv[1:] or list(SUITES)
unknown = [name for name in wanted if name not in SUITES]
if unknown:
    sys.exit(f"unknown suite: {' '.join(unknown)}. Use {' '.join(SUITES)}")
logs = Path(tempfile.mkdtemp(prefix="pi-suite-e2e-logs-"))
started = time.time()


def run(name):
    begun = time.time()
    with open(logs / f"{name}.log", "w") as log:
        code = subprocess.run(SUITES[name], cwd=REPO, stdout=log, stderr=subprocess.STDOUT).returncode
    print(f"{'ok  ' if code == 0 else 'FAIL'} {name} ({time.time() - begun:.0f}s)", flush=True)
    return code == 0


with ThreadPoolExecutor(len(wanted)) as pool:
    passed = dict(zip(wanted, pool.map(run, wanted)))
for name in (name for name, ok in passed.items() if not ok):
    print(f"\n--- {name}: {logs / (name + '.log')}")
    lines = (logs / f"{name}.log").read_text(errors="replace").splitlines()
    print("\n".join(line[:300] for line in lines if line.startswith(("FAIL", "not ok"))) or "\n".join(lines[-20:]))
print(f"\n{sum(passed.values())}/{len(passed)} suites passed in {time.time() - started:.0f}s")
sys.exit(0 if all(passed.values()) else 1)
