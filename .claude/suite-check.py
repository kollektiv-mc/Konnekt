#!/usr/bin/env python3
"""Run a repo's health checks from its .claude/suite.json.

This is the mechanical half of /suite-kit:health. It exists because the plugin
half does not reach every environment: declaring a plugin in .claude/settings.json
does not install it, so a cloud container or an unattended agent has no
/suite-kit:health, and .claude/suite.json is read by nothing. Vendoring this file
into each product — the same way tokens.source.json is vendored — puts the checks
back within reach of a bare clone. See docs/adopting.md.

The skill still owns judgement. This file owns running things and, above all,
telling the difference between a check that passed and a check that never ran.

  --json               Machine-readable report, for the skill to judge against.
  --section NAME       Run only these sections. Repeatable.
  --require-runnable   Treat every skip as a failure.
  --offline            Skip anything declaring requiresNetwork, without probing.

Exit codes: 0 no failures, 1 at least one failure, 2 could not run at all.
"""

import argparse
import fnmatch
import json
import os
import re
import shlex
import shutil
import socket
import subprocess
import sys

SECTIONS = ("commands", "invariants", "generated")

PASS, FAIL, SKIP = "pass", "fail", "skip"

# A command whose first word is one of these is shell syntax, not a binary, so
# the "is it installed" probe below does not apply to it.
SHELL_KEYWORDS = {
    "for", "while", "until", "if", "case", "select", "function",
    "{", "(", "!", "[[", "time", "do", "then",
}

# A tool that drives a project needs that project's manifest to exist before it
# can do anything. Having the binary installed is not the same as having
# something for it to run against, and conflating the two turns "this repo is
# not scaffolded yet" into a wall of red failures.
PROJECT_MANIFESTS = {
    "pnpm": "package.json",
    "npm": "package.json",
    "npx": "package.json",
    "yarn": "package.json",
    "go": "go.mod",
    "cargo": "Cargo.toml",
}


class Result:
    def __init__(self, section, name, status, reason="", details=None):
        self.section = section
        self.name = name
        self.status = status
        self.reason = reason
        self.details = details or []

    def as_dict(self):
        return {
            "section": self.section,
            "name": self.name,
            "status": self.status,
            "reason": self.reason,
            "details": self.details,
        }


# --- manifest -------------------------------------------------------------


def load_manifest(root):
    """Read .claude/suite.json, or explain why we cannot and stop.

    Every suite-kit skill opens by reading this file and stops if it is missing,
    rather than guessing a set of checks. A runner that invented its own checks
    when the manifest was absent would be worse than useless: it would report on
    a repo whose rules it had made up.
    """
    path = os.path.join(root, ".claude", "suite.json")
    if not os.path.isfile(path):
        return None, f"no .claude/suite.json at {root} — see kollektiv/docs/adopting.md"
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle), None
    except (OSError, ValueError) as exc:
        return None, f"{path} could not be read as JSON: {exc}"


# --- availability probes --------------------------------------------------


def posix_shell():
    r"""A POSIX shell to run manifest commands through, or None to use the default.

    Returns None everywhere except Windows, where the default shell is cmd.exe and
    every manifest in this suite is written in POSIX shell. `for f in scripts/*.sh;
    do ...; done` is a syntax error there, and `./scripts/foo.sh` is not runnable at
    all, so a repo whose checks were all fine reported two hard failures and four
    skips. That is worse than not running: a failure names the code, and this one
    was naming the operating system.

    subprocess's `executable=` argument is not the fix. On Windows it goes through
    the same list2cmdline quoting as a plain argument, so a shell under
    `C:\Program Files` is split at the space and exits 127. The caller uses
    [shell, "-c", command] instead, which quotes correctly.

    System32\bash.exe is excluded deliberately. That is the WSL launcher, and it
    runs in a different filesystem namespace where this repo's paths and cwd do not
    resolve — it would not error, it would check the wrong tree.
    """
    if os.name != "nt":
        return None

    def usable(path):
        if not path or not os.path.isfile(path):
            return False
        system32 = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32")
        return not os.path.normcase(path).startswith(os.path.normcase(system32))

    candidates = [os.environ.get("SHELL"), shutil.which("bash"), shutil.which("sh")]

    # Git for Windows ships bash, and git is already a hard requirement of the
    # generated section, so wherever git is, a usable shell is a sibling.
    git = shutil.which("git")
    if git:
        d = os.path.dirname(git)
        for up in (1, 2, 3):
            base = os.path.abspath(os.path.join(d, *([os.pardir] * up)))
            candidates.append(os.path.join(base, "bin", "bash.exe"))

    for c in candidates:
        if usable(c):
            return c
    return None


def shell_argv(command, shell):
    """subprocess arguments for running `command` through `shell` (or the default)."""
    if shell is None:
        return dict(args=command, shell=True)
    return dict(args=[shell, "-c", command])


def runnable(run, cwd, root, shell=None):
    """Whether a command has any chance of running, and why not if it does not.

    Checked before running rather than after, so an absent toolchain is reported
    as a skip instead of executing half a pipeline and reporting the wreckage as
    a failure. Two different absences count:

    The binary is not installed. And — the one that matters most right now — the
    binary is installed but the project it drives does not exist yet. Kommands is
    pre-scaffold: it has no package.json, and every one of its health.commands
    entries is a pnpm invocation. Without this second probe all four report as
    failures, when what they are is unrunnable. docs/adopting.md says exactly
    that: an entry that cannot run yet is skipped with a reason, never failed and
    never passed.

    Returns (True, "") or (False, reason).
    """
    first = run.strip().split()[0] if run.strip() else ""
    if not first or first in SHELL_KEYWORDS:
        return True, ""  # shell syntax; let the shell decide
    if not re.fullmatch(r"[A-Za-z0-9_.\-/]+", first):
        return True, ""  # a variable expansion or similar; not ours to judge

    # A command with a path in it is a file, not something to look up on PATH.
    # shutil.which resolves a relative path against the *process* cwd rather than
    # the entry's, and on Windows it consults PATHEXT, so a repo's own
    # ./scripts/foo.sh came back None there and every such entry reported as
    # "command not available" — a skip that named the wrong reason, for a script
    # sitting right there in the tree.
    if "/" in first or os.sep in first:
        if os.path.isfile(os.path.join(cwd, first)):
            return True, ""
        return False, f"no such file: {first}"

    # Probed through the same shell that will run the command, when there is one.
    # shutil.which answers for this process: on Windows it consults PATHEXT and so
    # cannot see a shell script the shell resolves happily. Asking two different
    # things what "available" means is how a runnable check gets reported as a
    # skip, and a skip is the one result nobody follows up on.
    if shell is None:
        found = shutil.which(first) is not None
    else:
        found = subprocess.run([shell, "-c", "command -v " + shlex.quote(first)],
                               capture_output=True).returncode == 0
    if not found:
        return False, f"command not available: {first}"

    tool = os.path.basename(first)
    manifest = PROJECT_MANIFESTS.get(tool)
    if manifest:
        if find_upwards(manifest, cwd, root) is None:
            return False, f"no {manifest} at or above {os.path.relpath(cwd, root)}"
    return True, ""


def environmental_failure(run, cwd, root):
    """Why a failure was the environment's fault rather than the code's, or None.

    Applied only after a command has actually failed, never before it runs.
    Pre-skipping anything that looked unrunnable was the obvious design and the
    wrong one: Konnekt's gen:tokens is a plain node script with no imports, so it
    regenerates correctly with node_modules absent. Skipping it on sight threw
    away a check that genuinely passes.

    So the rule is: run it, and only reinterpret the failure. eslint, tsc and
    vitest are all dependencies — with nothing installed they fail for a reason
    that has nothing to do with the code they were meant to check, and calling
    that a failing check is the same lie in the other direction as calling an
    empty grep a pass.
    """
    first = run.strip().split()[0] if run.strip() else ""
    tool = os.path.basename(first)
    if PROJECT_MANIFESTS.get(tool) == "package.json":
        if find_upwards("node_modules", cwd, root) is None:
            return "dependencies not installed (no node_modules)"
    return None


def find_upwards(name, cwd, root):
    """Find `name` in cwd, then upwards as far as the repo root. Path or None.

    Upwards because a workspace puts the manifest — and often the installed
    dependencies — above the directory a command runs in. Konnekt runs pnpm from
    frontend/ and go from the root out of one health.commands list.
    """
    current = os.path.abspath(cwd)
    root = os.path.abspath(root)
    while True:
        candidate = os.path.join(current, name)
        if os.path.exists(candidate):
            return candidate
        if current == root or current == os.path.dirname(current):
            return None
        current = os.path.dirname(current)


def network_available(timeout=3.0):
    """Best-effort reachability probe for requiresNetwork entries.

    Probed before running the generator rather than after it fails, so an offline
    machine reports a skip instead of a generator crash. Use --offline where the
    answer is known; this probe is a convenience, not an authority.
    """
    for host, port in (("1.1.1.1", 443), ("8.8.8.8", 53)):
        try:
            with socket.create_connection((host, port), timeout=timeout):
                return True
        except OSError:
            continue
    return False


# --- sections -------------------------------------------------------------


def run_commands(root, entries):
    results = []
    shell = posix_shell()
    for entry in entries:
        name, run = entry["name"], entry["run"]
        cwd = os.path.join(root, entry["cwd"]) if entry.get("cwd") else root

        if not os.path.isdir(cwd):
            results.append(Result("commands", name, SKIP,
                                  f"cwd {entry['cwd']!r} does not exist"))
            continue
        ok, reason = runnable(run, cwd, root, shell)
        if not ok:
            results.append(Result("commands", name, SKIP, reason))
            continue

        proc = subprocess.run(cwd=cwd, capture_output=True, text=True,
                              **shell_argv(run, shell))
        if proc.returncode == 127:
            results.append(Result("commands", name, SKIP, "command not found"))
        elif proc.returncode != 0:
            why = environmental_failure(run, cwd, root)
            if why:
                results.append(Result("commands", name, SKIP, why))
            else:
                output = (proc.stdout + proc.stderr).strip().splitlines()
                results.append(Result("commands", name, FAIL,
                                      f"exit {proc.returncode}", output[-20:]))
        else:
            results.append(Result("commands", name, PASS))
    return results


def is_excluded(rel, patterns):
    for pattern in patterns:
        if fnmatch.fnmatch(rel, pattern):
            return True
        # 'src/data/**' should exclude src/data itself and everything under it.
        if pattern.endswith("/**"):
            prefix = pattern[:-3]
            if rel == prefix or rel.startswith(prefix + "/"):
                return True
    return False


def files_under(root, rel_path, exclude):
    """Every readable text file under a repo-relative path, honouring exclude."""
    absolute = os.path.join(root, rel_path)
    if os.path.isfile(absolute):
        if not is_excluded(rel_path, exclude):
            yield rel_path, absolute
        return
    for dirpath, dirnames, filenames in os.walk(absolute):
        dirnames[:] = [
            d for d in sorted(dirnames)
            if d not in {".git", "node_modules", "dist", "build", ".venv"}
        ]
        for filename in sorted(filenames):
            full = os.path.join(dirpath, filename)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            if not is_excluded(rel, exclude):
                yield rel, full


def run_invariants(root, entries):
    """Each entry is a regex that must find nothing in the paths it covers.

    A match is a failure here, with no judgement applied. The skill's wording —
    judge a match against the diagnosis, not against the regex — is right for an
    interactive session and impossible for CI, which has no one to ask. So the
    legitimate exception stops being a decision made once in a session and
    becomes 'exclude' or a sharper regex: a commit a reviewer can see.
    """
    results = []
    for entry in entries:
        name = entry["name"]
        exclude = entry.get("exclude", [])
        pattern = re.compile(entry["grep"])

        present = [p for p in entry["paths"] if os.path.exists(os.path.join(root, p))]
        missing = [p for p in entry["paths"] if p not in present]

        # The defect this runner was written to remove: a grep over a path that
        # does not exist finds nothing, and 'found nothing' is indistinguishable
        # from 'passed' unless something says so out loud. Kommands has no src/
        # yet, so all three of its invariants land here.
        if not present:
            results.append(Result("invariants", name, SKIP,
                                  "paths not present: " + ", ".join(entry["paths"])))
            continue

        matches, unreadable = [], 0
        for rel_path in present:
            for rel, full in files_under(root, rel_path, exclude):
                try:
                    with open(full, encoding="utf-8") as handle:
                        for lineno, line in enumerate(handle, 1):
                            if pattern.search(line):
                                matches.append(f"{rel}:{lineno}: {line.strip()[:120]}")
                except (OSError, UnicodeDecodeError):
                    unreadable += 1

        reason = ""
        if missing:
            reason = "searched " + ", ".join(present) + "; not present: " + ", ".join(missing)
        if unreadable:
            reason = (reason + "; " if reason else "") + f"{unreadable} unreadable file(s)"

        if matches:
            results.append(Result("invariants", name, FAIL,
                                  reason or f"{len(matches)} match(es)", matches[:50]))
        else:
            results.append(Result("invariants", name, PASS, reason))
    return results


def run_generated(root, entries, offline):
    shell = posix_shell()
    results = []
    in_git = subprocess.run(["git", "rev-parse", "--git-dir"], cwd=root,
                            capture_output=True).returncode == 0

    for entry in entries:
        regenerate = entry["regenerate"]
        name = regenerate
        cwd = os.path.join(root, entry["cwd"]) if entry.get("cwd") else root

        if not in_git:
            results.append(Result("generated", name, SKIP, "not a git checkout"))
            continue
        if entry.get("requiresNetwork") and (offline or not network_available()):
            results.append(Result("generated", name, SKIP, "offline"))
            continue
        if not os.path.isdir(cwd):
            results.append(Result("generated", name, SKIP,
                                  f"cwd {entry['cwd']!r} does not exist"))
            continue
        ok, reason = runnable(regenerate, cwd, root, shell)
        if not ok:
            results.append(Result("generated", name, SKIP, reason))
            continue

        proc = subprocess.run(cwd=cwd, capture_output=True, text=True,
                              **shell_argv(regenerate, shell))
        if proc.returncode == 127:
            results.append(Result("generated", name, SKIP, "command not found"))
            continue
        if proc.returncode != 0:
            why = environmental_failure(regenerate, cwd, root)
            if why:
                results.append(Result("generated", name, SKIP, why))
            else:
                output = (proc.stdout + proc.stderr).strip().splitlines()
                results.append(Result("generated", name, FAIL,
                                      f"generator exited {proc.returncode}", output[-20:]))
            continue

        # --porcelain rather than 'git diff', so a generated file that is new and
        # still untracked counts. A hand-edited generated file and an uncommitted
        # regeneration are the same bug and both must show up here.
        status = subprocess.run(
            ["git", "status", "--porcelain", "--"] + entry["expectCleanDiff"],
            cwd=root, capture_output=True, text=True,
        )
        dirty = [line for line in status.stdout.splitlines() if line.strip()]
        if dirty:
            results.append(Result("generated", name, FAIL,
                                  "regenerating changed committed output", dirty))
        else:
            results.append(Result("generated", name, PASS))
    return results


# --- reporting ------------------------------------------------------------


def render_table(results):
    lines = ["| Section | Check | Result | Notes |", "|---|---|---|---|"]
    for r in results:
        note = r.reason.replace("|", "\\|")
        lines.append(f"| {r.section} | {r.name} | {r.status} | {note} |")
    return "\n".join(lines)


def render_details(results):
    blocks = []
    for r in results:
        if r.status == FAIL and r.details:
            blocks.append(f"\n{r.section} / {r.name}:")
            blocks.extend(f"  {line}" for line in r.details)
    return "\n".join(blocks)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--section", action="append", choices=SECTIONS, default=None)
    parser.add_argument("--require-runnable", action="store_true")
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--root", default=".")
    args = parser.parse_args()

    root = os.path.abspath(args.root)
    manifest, error = load_manifest(root)
    if error:
        print(error, file=sys.stderr)
        return 2

    health = manifest.get("health") or {}
    wanted = tuple(args.section) if args.section else SECTIONS

    results = []
    if "commands" in wanted:
        results += run_commands(root, health.get("commands", []))
    if "invariants" in wanted:
        results += run_invariants(root, health.get("invariants", []))
    if "generated" in wanted:
        results += run_generated(root, health.get("generated", []), args.offline)

    failed = [r for r in results if r.status == FAIL]
    skipped = [r for r in results if r.status == SKIP]

    if args.json:
        print(json.dumps({
            "product": manifest.get("product"),
            "sections": list(wanted),
            "results": [r.as_dict() for r in results],
            "summary": {
                "pass": sum(1 for r in results if r.status == PASS),
                "fail": len(failed),
                "skip": len(skipped),
            },
        }, indent=2))
    else:
        print(f"{manifest.get('product', root)} — {len(results)} check(s)\n")
        print(render_table(results) if results else "no checks declared for these sections")
        details = render_details(results)
        if details:
            print(details)
        if skipped:
            # Stated every run, because the whole point of the file is that these
            # are not passes. CLAUDE.md: most of the value of the health check is
            # the gap between "I ran the checks" and "the checks passed".
            print(f"\n{len(skipped)} check(s) skipped — skipped is not passed.")

    if failed:
        return 1
    if skipped and args.require_runnable:
        print(f"{len(skipped)} check(s) could not run and --require-runnable is set",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
