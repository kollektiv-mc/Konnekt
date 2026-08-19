#!/usr/bin/env python3
"""Build the changelog body for a release — the nightly `snapshot` prerelease
and tagged releases alike.

GitHub's own `releases/generate-notes` cannot do the things a shipped build's
changelog needs:

  * It has no notion of *what* a pull request touched, so the website — which
    lives in this repo but ships to Cloudflare Pages, not into the binary —
    fills the notes of a build that does not contain a line of it.
  * It sorts purely by label, so an unlabelled pull request can only land in the
    catch-all, which is where nearly every one of them ended up.

So this script does the same job with the changed-path filter and the
categorisation rules a shipped build actually wants. Both workflows call it, so
a snapshot and the release it is ahead of describe themselves the same way.

What a reader of these notes is owed
------------------------------------

The notes describe *the binary they are about to download*. Everything here
follows from that:

  * Work that ships nowhere near the binary is not in the notes at all. The
    paths that mean this are per-repo facts and live in .github/changelog.json,
    not in this file.
  * A `type:` label decides the section. A title is prose written for a
    reviewer; a label is a deliberate statement about what the change is, and
    CI's `pr-labelled` job is what makes it a reliable one.
  * An unlabelled pull request can never reach Features. Guessing from the
    leading verb once promoted "Add a Full release roadmap section and a nightly
    snapshot build channel" — a website and CI change — into the section users
    read first. A wrong Features entry costs more than a vague Other one, so the
    guess is only allowed to reach the sections where being wrong is cheap.
  * Maintenance and documentation are counted, not listed. `type:chore` and
    `type:docs` are real work that changed nothing a user can observe; the
    footer says how many there were and the full-changelog link has them all.

Reads:

  GH_TOKEN   a token that can read this repository (required)
  REPO       owner/name (required)
  HEAD_REF   the commit or tag being described (required)
  BASE_TAG   what to measure from. Defaults to the latest published release,
             which is the right answer for both callers: that endpoint skips
             prereleases, so `snapshot` can never become its own baseline, and
             a tagged release's own entry does not exist yet when it runs.
  SERVER     github.com base URL, for the compare link
  CONFIG     path to the per-repo config. Defaults to .github/changelog.json
             next to this script.

Writes the markdown body to stdout. Exits non-zero on any failure, including
having no baseline to measure from — each caller has a fallback, so losing the
notes never costs the build.
"""

from __future__ import annotations

import json
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# Labels win over anything read out of the title, because a label is a
# deliberate statement and a title is prose. Names come from the suite's
# taxonomy in kollektiv's design/labels.json.
FEATURE_LABELS = {"type:feature", "feature", "enhancement"}
FIX_LABELS = {"type:bug", "bug"}

# Counted in the footer rather than listed. These are labels for work that
# changed no observable behaviour, so a reader scanning for what is different
# about this build gains nothing from the titles and loses the signal in them.
QUIET_LABELS = {"type:chore", "type:docs", "chore", "documentation"}

# The explicit escape hatch, for work that fits none of the above and should
# simply not be mentioned. Not counted anywhere: the point of asking for silence
# is silence.
SKIP_LABELS = {"changelog:skip"}

# Conventional-commit types, for the titles that carry one. A prefix someone
# typed on purpose is a statement in the way a bare verb is not, so `feat:` is
# allowed to reach Features where "Add ..." is not.
FEATURE_TYPES = {"feat", "feature"}
FIX_TYPES = {"fix", "bugfix", "hotfix", "perf"}
QUIET_TYPES = {"chore", "docs", "test", "tests", "refactor", "ci", "build", "style"}

# Last resort, for an unlabelled title with no conventional prefix. Only fix
# verbs are listed, and deliberately: see the module docstring on why nothing
# reaches Features by guesswork. A title this does not match lands in "Other
# changes", which is an honest answer rather than a wrong one — and a visible
# one, since a correctly labelled repo leaves that section empty.
FIX_VERBS = {
    "fix", "fixes", "fixed", "correct", "corrects", "repair", "repairs", "resolve",
    "resolves", "prevent", "prevents", "restore", "restores", "unbreak", "unbreaks",
    "patch", "patches", "harden", "hardens", "stop", "stops",
}

FEATURES, FIXES, OTHER = "Features", "Fixes", "Other changes"
SECTIONS = (FEATURES, FIXES, OTHER)

# Sentinels for the two ways a pull request leaves the notes, kept apart from
# the section names so the footer can say which happened.
QUIET, SKIP = "quiet", "skip"

CONVENTIONAL = re.compile(r"^([a-z]+)(?:\([^)]*\))?!?:\s*")

API = os.environ.get("GITHUB_API_URL", "https://api.github.com").rstrip("/")

DEFAULT_CONFIG = pathlib.Path(__file__).resolve().parent.parent / "changelog.json"

# A hundred-odd calls go into one changelog, so a request that fails for a
# reason unrelated to what was asked gets a few more chances before the run is
# written off.
RETRIES = 4
BACKOFF_SECONDS = 2


class ApiError(RuntimeError):
    """A request that could not be completed, naming the request.

    The path matters in the log: "HTTP Error 500" alone leaves whoever reads a
    failed run with a hundred candidate calls and no way to choose between them.
    """

    def __init__(self, path: str, detail: object, code: int | None = None) -> None:
        self.path = path
        self.code = code
        super().__init__(f"GET {path} -> {detail}")


def api(path: str, **params: object) -> object:
    """GET one page of the REST API, decoded.

    Retries the failures that say nothing about the request — 5xx, and the 429
    or 403 the API answers with when it wants you to slow down. Describing one
    release takes on the order of a hundred calls, so a single unlucky 500 costs
    the whole changelog, and that is exactly how the first real run of this
    script ended: one 500, no retry, notes replaced by a bare commit link. A 4xx
    that means what it says is raised at once, because retrying a 404 only
    delays the report.
    """
    url = f"{API}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {os.environ['GH_TOKEN']}",
            "User-Agent": "konnekt-release-notes",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    for attempt in range(RETRIES):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if (error.code < 500 and error.code not in (403, 429)) or attempt == RETRIES - 1:
                raise ApiError(path, f"HTTP {error.code}", error.code) from error
            detail = f"HTTP {error.code}"
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            if attempt == RETRIES - 1:
                raise ApiError(path, error) from error
            detail = str(error)
        delay = BACKOFF_SECONDS * 2**attempt
        print(f"GET {path} -> {detail}, retrying in {delay}s", file=sys.stderr)
        time.sleep(delay)
    raise AssertionError("unreachable")


def load_non_app_paths(config_path: pathlib.Path) -> tuple[str, ...]:
    """The path prefixes that never reach the binary, from the repo's config.

    Missing or malformed is a hard failure rather than an empty list. An empty
    list is not a safe default here — it is the bug this filter exists to stop,
    and it would produce notes that look fine while describing a build that
    contains none of what they list. Both callers annotate the failure and fall
    back to a commit link, which is at least visibly degraded.
    """
    try:
        raw = json.loads(config_path.read_text())
    except FileNotFoundError as error:
        raise ApiError(str(config_path), "no such file — this repo has not been configured") from error
    except json.JSONDecodeError as error:
        raise ApiError(str(config_path), f"not valid JSON: {error}") from error

    paths = raw.get("nonAppPaths")
    if not isinstance(paths, list) or not all(isinstance(p, str) for p in paths):
        raise ApiError(str(config_path), "nonAppPaths must be a list of strings")
    return tuple(paths)


def commits_in_range(repo: str, base: str, head: str) -> list[dict]:
    """Every commit reachable from `head` but not `base`.

    The compare endpoint reports the true total alongside a page of commits, so
    page until the two agree. 100 per page is its documented ceiling; it does
    serve more if asked, but there is nothing to gain from depending on that.
    The page ceiling only exists so a bad range cannot spin forever, and 2500
    commits is far past any plausible release window.
    """
    collected: list[dict] = []
    for page in range(1, 26):
        payload = api(f"/repos/{repo}/compare/{base}...{head}", page=page, per_page=100)
        collected.extend(payload.get("commits") or [])
        if len(collected) >= payload.get("total_commits", 0) or not payload.get("commits"):
            break
    return collected


def merged_pulls(repo: str, commits: list[dict]) -> list[dict]:
    """The merged pull requests those commits came from, oldest merge first.

    A commit can be associated with more than one pull request — its own, plus
    any still-open branch that has it — so this keeps only merged ones, and
    dedupes because every commit of a pull request names it.
    """
    pulls: dict[int, dict] = {}
    for commit in commits:
        for pull in api(f"/repos/{repo}/commits/{commit['sha']}/pulls", per_page=100):
            if pull.get("merged_at") and pull["number"] not in pulls:
                pulls[pull["number"]] = pull
    return sorted(pulls.values(), key=lambda pull: (pull["merged_at"], pull["number"]))


def touches_app(repo: str, number: int, non_app_paths: tuple[str, ...]) -> bool:
    """Whether a pull request changed anything outside the non-app paths.

    Returns early on the first app-side file, so the common case — a pull
    request that is mostly app work — costs one page. An unreadable or
    absurdly large file list is reported as app-side: a changelog that keeps
    something it could not classify is better than one that quietly drops it.
    """
    for page in range(1, 31):
        files = api(f"/repos/{repo}/pulls/{number}/files", page=page, per_page=100)
        if not files:
            return False
        for changed in files:
            if not changed["filename"].startswith(non_app_paths):
                return True
        if len(files) < 100:
            return False
    return True


def section_for(pull: dict) -> str:
    """Which section a pull request belongs in, or QUIET / SKIP to leave it out.

    Order matters: an explicit skip beats everything, then labels in descending
    specificity, then a conventional-commit prefix, then the fix-verb guess.
    """
    labels = {label["name"].lower() for label in pull.get("labels") or []}
    if labels & SKIP_LABELS:
        return SKIP
    if labels & FEATURE_LABELS:
        return FEATURES
    if labels & FIX_LABELS:
        return FIXES
    if labels & QUIET_LABELS:
        return QUIET

    title = (pull.get("title") or "").strip()
    conventional = CONVENTIONAL.match(title)
    if conventional:
        kind = conventional.group(1)
        if kind in FEATURE_TYPES:
            return FEATURES
        if kind in FIX_TYPES:
            return FIXES
        if kind in QUIET_TYPES:
            return QUIET
        # A prefix that isn't a conventional type is a scope someone wrote by
        # hand ("website: ..."). Drop it so the verb check below reads the
        # sentence rather than the scope.
        title = title[conventional.end():].strip()

    verb = re.sub(r"[^a-z]", "", title.split(" ")[0].lower()) if title else ""
    return FIXES if verb in FIX_VERBS else OTHER


def entry(pull: dict) -> str:
    # GitHub's own generate-notes appends " by @user in <PR URL>" to every
    # bullet, which is attribution for the PR, not something a changelog
    # meant for users of the app needs repeated on every line. This mirrors
    # that generator everywhere else, so it deliberately doesn't here.
    title = " ".join((pull.get("title") or f"Pull request #{pull['number']}").split())
    return f"* {title}"


def footer(not_shipped: int, quiet: int) -> str:
    """One line accounting for what was left out, or "" when nothing was.

    Said out loud rather than passed over: a changelog that silently drops two
    thirds of the merged work reads as a quiet release, and the reader has no
    way to tell that from an accurate one.
    """
    clauses = []
    if not_shipped:
        clauses.append(f"{not_shipped} changed nothing that ships in this build")
    if quiet:
        clauses.append(f"{quiet} maintenance or documentation")
    if not clauses:
        return ""
    total = not_shipped + quiet
    noun = "pull request is" if total == 1 else "pull requests are"
    return f"_{total} {noun} not listed: {', '.join(clauses)}._"


def latest_release_tag(repo: str) -> str:
    """The newest published release's tag, or "" when there isn't one yet."""
    try:
        return (api(f"/repos/{repo}/releases/latest").get("tag_name") or "").strip()
    except ApiError as error:
        if error.code == 404:  # a repo with no published release
            return ""
        raise


def main() -> int:
    repo = os.environ["REPO"]
    head = os.environ["HEAD_REF"]
    server = os.environ.get("SERVER", "https://github.com").rstrip("/")
    config_path = pathlib.Path(os.environ.get("CONFIG") or DEFAULT_CONFIG)

    non_app_paths = load_non_app_paths(config_path)

    base = os.environ.get("BASE_TAG", "").strip() or latest_release_tag(repo)
    if not base:
        print("no published release to measure against", file=sys.stderr)
        return 1

    commits = commits_in_range(repo, base, head)
    grouped: dict[str, list[str]] = {section: [] for section in SECTIONS}
    not_shipped = 0
    quiet = 0

    for pull in merged_pulls(repo, commits):
        section = section_for(pull)
        if section == SKIP:
            continue
        # The path check costs a request per pull request, so it runs after the
        # cheap label read — a skipped or quiet pull request never needs it.
        if not touches_app(repo, pull["number"], non_app_paths):
            not_shipped += 1
            continue
        if section == QUIET:
            quiet += 1
            continue
        grouped[section].append(entry(pull))

    lines = ["## What's changed", ""]
    for section in SECTIONS:
        if grouped[section]:
            lines += [f"### {section}", *grouped[section], ""]

    if not any(grouped.values()):
        lines += ["No user-facing changes since the last release.", ""]

    accounting = footer(not_shipped, quiet)
    if accounting:
        lines += [accounting, ""]

    lines.append(f"**Full changelog**: {server}/{repo}/compare/{base}...{head}")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ApiError, KeyError, OSError) as error:
        print(f"could not build the changelog: {error}", file=sys.stderr)
        sys.exit(1)
