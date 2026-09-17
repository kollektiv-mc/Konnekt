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
import importlib.util
import json
import os
import re
import subprocess
import sys

SECTIONS = ("commands", "invariants", "generated", "memory")

PASS, FAIL, SKIP = "pass", "fail", "skip"

HERE = os.path.dirname(os.path.abspath(__file__))


def load_sibling(stem):
    """Import a module vendored beside this file, or None if it is not there.

    Beside rather than on sys.path because that is what vendoring guarantees: the
    product commits these files into .claude/ and nothing installs them.
    """
    path = os.path.join(HERE, f"{stem}.py")
    if not os.path.isfile(path):
        return None
    spec = importlib.util.spec_from_file_location(stem.replace("-", "_"), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# The probes are what tell a skip from a failure, which is the one thing this
# runner exists to get right, so an absent suite-probe.py is fatal. The memory
# budget degrades to a skip instead, because a report missing one section is
# still worth reading.
probe = load_sibling("suite-probe")
if probe is None:
    print(
        "suite-probe.py is not vendored beside this file — re-run"
        " kollektiv/scripts/sync-runner.sh",
        file=sys.stderr,
    )
    raise SystemExit(2)

posix_shell = probe.posix_shell
shell_argv = probe.shell_argv
runnable = probe.runnable
environmental_failure = probe.environmental_failure
network_available = probe.network_available


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


# --- sections -------------------------------------------------------------


def run_commands(root, entries):
    results = []
    shell = posix_shell()
    for entry in entries:
        name, run = entry["name"], entry["run"]
        cwd = os.path.join(root, entry["cwd"]) if entry.get("cwd") else root

        if not os.path.isdir(cwd):
            results.append(
                Result("commands", name, SKIP, f"cwd {entry['cwd']!r} does not exist")
            )
            continue
        ok, reason = runnable(run, cwd, root, shell)
        if not ok:
            results.append(Result("commands", name, SKIP, reason))
            continue

        proc = subprocess.run(
            cwd=cwd,
            capture_output=True,
            text=True,
            check=False,
            **shell_argv(run, shell),
        )
        if proc.returncode == 127:
            results.append(Result("commands", name, SKIP, "command not found"))
        elif proc.returncode != 0:
            why = environmental_failure(run, cwd, root, proc.stdout + proc.stderr)
            if why:
                results.append(Result("commands", name, SKIP, why))
            else:
                output = (proc.stdout + proc.stderr).strip().splitlines()
                results.append(
                    Result(
                        "commands", name, FAIL, f"exit {proc.returncode}", output[-20:]
                    )
                )
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
            d
            for d in sorted(dirnames)
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
            results.append(
                Result(
                    "invariants",
                    name,
                    SKIP,
                    "paths not present: " + ", ".join(entry["paths"]),
                )
            )
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
            reason = (
                "searched "
                + ", ".join(present)
                + "; not present: "
                + ", ".join(missing)
            )
        if unreadable:
            reason = (
                reason + "; " if reason else ""
            ) + f"{unreadable} unreadable file(s)"

        if matches:
            results.append(
                Result(
                    "invariants",
                    name,
                    FAIL,
                    reason or f"{len(matches)} match(es)",
                    matches[:50],
                )
            )
        else:
            results.append(Result("invariants", name, PASS, reason))
    return results


def run_generated(root, entries, offline):
    shell = posix_shell()
    results = []
    in_git = (
        subprocess.run(
            ["git", "rev-parse", "--git-dir"],
            cwd=root,
            capture_output=True,
            check=False,
        ).returncode
        == 0
    )

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
            results.append(
                Result("generated", name, SKIP, f"cwd {entry['cwd']!r} does not exist")
            )
            continue
        ok, reason = runnable(regenerate, cwd, root, shell)
        if not ok:
            results.append(Result("generated", name, SKIP, reason))
            continue

        proc = subprocess.run(
            cwd=cwd,
            capture_output=True,
            text=True,
            check=False,
            **shell_argv(regenerate, shell),
        )
        if proc.returncode == 127:
            results.append(Result("generated", name, SKIP, "command not found"))
            continue
        if proc.returncode != 0:
            why = environmental_failure(
                regenerate, cwd, root, proc.stdout + proc.stderr
            )
            if why:
                results.append(Result("generated", name, SKIP, why))
            else:
                output = (proc.stdout + proc.stderr).strip().splitlines()
                results.append(
                    Result(
                        "generated",
                        name,
                        FAIL,
                        f"generator exited {proc.returncode}",
                        output[-20:],
                    )
                )
            continue

        # --porcelain rather than 'git diff', so a generated file that is new and
        # still untracked counts. A hand-edited generated file and an uncommitted
        # regeneration are the same bug and both must show up here.
        status = subprocess.run(
            ["git", "status", "--porcelain", "--"] + entry["expectCleanDiff"],
            cwd=root,
            capture_output=True,
            text=True,
            check=False,
        )
        dirty = [line for line in status.stdout.splitlines() if line.strip()]
        if dirty:
            results.append(
                Result(
                    "generated",
                    name,
                    FAIL,
                    "regenerating changed committed output",
                    dirty,
                )
            )
        else:
            results.append(Result("generated", name, PASS))
    return results


def run_memory(root, config):
    """The always-loaded agent memory budget, from the module beside this file.

    Vendored as a trio by sync-runner.sh. A product carrying some of it and not
    the rest has a stale vendoring: a skip with a reason, never a crash and never
    a pass.
    """
    name = "always-loaded memory"
    module = load_sibling("suite-memory")
    if module is None:
        return [
            Result(
                "memory", name, SKIP, "suite-memory.py is not vendored beside this file"
            )
        ]
    return [Result("memory", name, *module.evaluate(root, config))]


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
    if "memory" in wanted:
        results += run_memory(root, health.get("memory"))

    failed = [r for r in results if r.status == FAIL]
    skipped = [r for r in results if r.status == SKIP]

    if args.json:
        print(
            json.dumps(
                {
                    "product": manifest.get("product"),
                    "sections": list(wanted),
                    "results": [r.as_dict() for r in results],
                    "summary": {
                        "pass": sum(1 for r in results if r.status == PASS),
                        "fail": len(failed),
                        "skip": len(skipped),
                    },
                },
                indent=2,
            )
        )
    else:
        print(f"{manifest.get('product', root)} — {len(results)} check(s)\n")
        print(
            render_table(results)
            if results
            else "no checks declared for these sections"
        )
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
        print(
            f"{len(skipped)} check(s) could not run and --require-runnable is set",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
