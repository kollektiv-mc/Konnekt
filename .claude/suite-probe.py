#!/usr/bin/env python3
"""Whether a health check can run, and whether its failure was the environment's.

Split out of suite-check.py, which had grown past the size its own aislop ratchet
allows. The seam is the one the file already named: everything here answers a
question *about* a command rather than running one, and none of it touches the
Result type or the report.

That makes it the part worth testing directly, which suite-check_test.py does.
The runner loads this module from beside itself, the way it loads suite-memory.py,
so the three vendor and travel together. Unlike the memory budget, this one has no
graceful absence: a runner that cannot tell a skip from a failure has nothing
useful to report, so suite-check.py fails loudly when it is missing.
"""

import os
import re
import shlex
import shutil
import socket
import subprocess

# A command whose first word is one of these is shell syntax, not a binary, so
# the "is it installed" probe below does not apply to it.
SHELL_KEYWORDS = {
    "for",
    "while",
    "until",
    "if",
    "case",
    "select",
    "function",
    "{",
    "(",
    "!",
    "[[",
    "time",
    "do",
    "then",
}

# A tool that drives a project needs that project's manifest to exist before it
# can do anything. Having the binary installed is not the same as having
# something for it to run against, and conflating the two turns "this repo is
# not scaffolded yet" into a wall of red failures.
#
# npx is deliberately not here. `npx --yes <package>` fetches and runs a tool
# against whatever directory it is in, package.json or not, which is how the
# aislop gate runs in kollektiv, a repo with no JavaScript. Listing it did two
# wrong things: kollektiv's aislop check was skipped on sight, and in a product
# an aislop failure with no node_modules installed was reported as
# "dependencies not installed" rather than as the failure it was.
PROJECT_MANIFESTS = {
    "pnpm": "package.json",
    "npm": "package.json",
    "yarn": "package.json",
    "go": "go.mod",
    "cargo": "Cargo.toml",
}


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
        return {"args": command, "shell": True}
    return {"args": [shell, "-c", command]}


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
        found = (
            subprocess.run(
                [shell, "-c", "command -v " + shlex.quote(first)],
                capture_output=True,
                check=False,
            ).returncode
            == 0
        )
    if not found:
        return False, f"command not available: {first}"

    tool = os.path.basename(first)
    manifest = PROJECT_MANIFESTS.get(tool)
    if manifest and find_upwards(manifest, cwd, root) is None:
        return False, f"no {manifest} at or above {os.path.relpath(cwd, root)}"

    gap = aislop_ruff_gap(run, root, shell)
    if gap:
        return False, gap
    return True, ""


# The pin CI installs, written as pip would take it. Every adopting repo carries
# it: a product in its vendored .github/workflows/aislop.yml, kollektiv inline in
# ci.yml, because kollektiv is not a product and carries those steps itself.
RUFF_PIN = re.compile(r"\bruff==(\d+(?:\.\d+)*)")

# What `ruff --version` answers with.
RUFF_REPORTED = re.compile(r"\bruff\s+(\d+(?:\.\d+)*)")


def pinned_ruff(root):
    """The ruff version this repo's workflows pin, or None if that is not certain.

    The workflow is the single source of truth on purpose. Writing the version
    anywhere else, here included, would give the suite a second place to say what
    it pins, and two places that can disagree is the shape of the bug this whole
    check exists to catch.

    Disagreeing workflows return None rather than a guess. That is a real problem
    of its own, but it is not this function's to name, and picking one of two
    answers would be exactly the confident wrong number the runner must not
    produce.
    """
    directory = os.path.join(root, ".github", "workflows")
    if not os.path.isdir(directory):
        return None

    found = set()
    for name in sorted(os.listdir(directory)):
        if not name.endswith((".yml", ".yaml")):
            continue
        try:
            with open(os.path.join(directory, name), encoding="utf-8") as handle:
                found.update(RUFF_PIN.findall(handle.read()))
        except (OSError, UnicodeDecodeError):
            continue
    return found.pop() if len(found) == 1 else None


def aislop_ruff_gap(run, root, shell=None):
    """Why an aislop run here would not mean what CI means by it, or None.

    aislop's Python formatting and lint engines run only when a ruff binary is on
    PATH. With none they do not report a skip: the run comes back `[ok] 0 issues`,
    100 of 100, and its JSON says `"skipped": false` with empty diagnostics. A
    degraded run is identical in every field aislop exposes to a clean one, so
    there is nothing in the output to read afterwards. A wrong version is the same
    problem quieter: 0.15.8 and 0.16.7 disagree about real findings in this tree.

    That is why this is a pre-skip, against the rule the sibling docstring in
    environmental_failure argues for. The rule there is do not pre-judge whether a
    command will fail, and it still holds: this does not predict a failure. The
    command will pass. What is provable before running it is that passing would
    not mean anything, and a pass that means nothing is worse than the skip it
    should have been, because nobody follows up on either but only one is honest.
    """
    if "aislop" not in run:
        return None
    want = pinned_ruff(root)
    if want is None:
        return None

    argv = ["ruff", "--version"] if shell is None else [shell, "-c", "ruff --version"]
    try:
        probe = subprocess.run(argv, capture_output=True, text=True, check=False)
    except OSError:
        probe = None
    if probe is None or probe.returncode != 0:
        return f"ruff {want} is not on PATH; aislop would score no Python"

    match = RUFF_REPORTED.search(probe.stdout or probe.stderr or "")
    if match is None:
        return f"ruff {want} is pinned but its version could not be read"
    if match.group(1) != want:
        return f"ruff {want} is pinned for aislop; {match.group(1)} is on PATH"
    return None


# Go compiles //go:embed directives during vet and test, so a package embedding a
# frontend bundle cannot be checked until that bundle is on disk. The failure
# names the pattern, relative to the directory of the source file it names:
#
#   main.go:15:12: pattern all:frontend/dist: no matching files found
GO_EMBED_MISS = re.compile(
    r"^(?P<src>\S+?\.go):\d+:\d+: pattern (?P<pattern>\S+?): no matching files found",
    re.MULTILINE,
)


def other_failures(output, embed_lines):
    """Whether anything failed besides the given //go:embed misses.

    Reads only the lines that assert something went wrong. Package headers, the
    `[build failed]` and `[setup failed]` markers and the trailing bare FAIL are
    consequences of a cause printed elsewhere, so counting them would make every
    embed miss look accompanied.
    """
    for line in output.splitlines():
        stripped = line.strip()
        if not stripped or stripped in embed_lines:
            continue
        if re.match(r"\S+\.go:\d+:\d+:", stripped) or stripped.startswith("vet: "):
            return True
        if stripped.startswith("--- FAIL"):
            return True
        # A package that failed its own tests rather than a build it never got
        # to: those name their reason in brackets.
        if stripped.startswith("FAIL") and stripped != "FAIL" and "[" not in stripped:
            return True
    return False


def missing_build_output(output, cwd):
    """The absent gitignored path a //go:embed failure names, or None.

    Gitignored and absent is build output nobody has built; absent and tracked is
    a file genuinely missing from the tree. Only the first is the environment's
    fault. Anything unprovable returns None and the failure stands: a checkout
    that is not a git repo cannot answer, and guessing hides the case this exists
    to keep visible.
    """
    misses = list(GO_EMBED_MISS.finditer(output))
    if not misses:
        return None
    # `go vet` stops at the load error, but `go test` carries on into the other
    # packages and prints their failures beside this one. An embed miss excuses
    # the run only when it is the whole of what went wrong; otherwise this would
    # bury a broken build under a reassuring skip.
    if other_failures(output, {match.group(0).strip() for match in misses}):
        return None

    for match in misses:
        pattern = match.group("pattern")
        pattern = pattern.removeprefix("all:")
        # A glob matching nothing is not a directory that was never built.
        literal = re.split(r"[*?\[]", pattern, maxsplit=1)[0]
        if not literal:
            continue
        src_dir = os.path.dirname(os.path.join(cwd, match.group("src")))
        target = os.path.normpath(os.path.join(src_dir, literal))
        if os.path.exists(target):
            continue

        # Asked with a trailing separator first: the target does not exist, so
        # git cannot see it was a directory, and an entry written `dist/` matches
        # directories only. The real Konnekt case answered "not ignored" without
        # it. Run from cwd rather than src_dir because only cwd is certain to
        # exist, and `git -C` on a missing directory exits 128.
        posix = target.replace(os.sep, "/")
        for candidate in (posix + "/", posix):
            try:
                probe = subprocess.run(
                    ["git", "-C", cwd, "check-ignore", "-q", candidate],
                    capture_output=True,
                    check=False,
                )
            except OSError:
                return None
            if probe.returncode == 0:
                return os.path.relpath(target, cwd)
    return None


def environmental_failure(run, cwd, root, output=""):
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

    The Go case is the same shape one language over. Both desktop products embed
    their Vite build and both gitignore it, so `go vet ./...` on a fresh clone
    fails in the root package before reading a line of Go. Konnekt reported that
    as two red checks on every cloud session; Kommands avoided it by narrowing
    its go entries to the packages that do not embed, which buys a green table by
    never checking the package most likely to break.
    """
    first = run.strip().split()[0] if run.strip() else ""
    tool = os.path.basename(first)
    if (
        PROJECT_MANIFESTS.get(tool) == "package.json"
        and find_upwards("node_modules", cwd, root) is None
    ):
        return "dependencies not installed (no node_modules)"
    if PROJECT_MANIFESTS.get(tool) == "go.mod":
        missing = missing_build_output(output, cwd)
        if missing:
            return f"embedded build output not present (no {missing})"
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
