// Holds agent_docs/HEALTH_LOG.md under its cap, and the archive beside it to
// one shape.
//
// The log is the record of closed health work, and once its entries were
// dated it grew by about 2,200 lines a month: 6,182 lines by 2026-10-14, past
// what a session opens in one go. The header there states the rule; this is
// the gate behind it, run from the health manifest (.claude/suite.json) and
// from CI's invariants job, so an entry that takes the file over the cap pays
// for it in the same pull request by moving the oldest whole month out. The
// runner's invariants are regexes that must find nothing, and a line count is
// not one, which is why this is a script of its own.
//
// What it checks:
//   1. agent_docs/HEALTH_LOG.md is at most CAP lines
//   2. Every file under agent_docs/health-log/ is a month, YYYY-MM.md, or
//      undated.md, so the archive stays one file per month
//   3. No dated entry in the live log falls in an archived month or earlier,
//      so an entry cannot land in a month that has already moved out
//
// Zero dependencies, same as the other scripts here.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");
const LOG = "agent_docs/HEALTH_LOG.md";
const ARCHIVE = "agent_docs/health-log";
const CAP = 3000;

const problems = [];
const fail = (m) => problems.push(m);

const text = readFileSync(path.join(ROOT, LOG), "utf8");
const lines = text.split("\n");
const count = text.endsWith("\n") ? lines.length - 1 : lines.length;
if (count > CAP) {
  fail(
    `${LOG} is ${count} lines against a cap of ${CAP}. Move the oldest whole ` +
      `month, index lines included, to ${ARCHIVE}/YYYY-MM.md until it is ` +
      `under again; the header there has the rule.`,
  );
}

const months = [];
for (const name of readdirSync(path.join(ROOT, ARCHIVE)).sort()) {
  const month = /^(\d{4}-\d{2})\.md$/.exec(name);
  if (month) months.push(month[1]);
  else if (name !== "undated.md")
    fail(`${ARCHIVE}/${name}: an archived file is a month, YYYY-MM.md, or undated.md`);
}
const newest = months.at(-1);

lines.forEach((line, i) => {
  const dated = /^#{2,3} (\d{4}-\d{2})-\d{2} /.exec(line);
  if (dated && newest && dated[1] <= newest)
    fail(
      `${LOG}:${i + 1}: an entry dated ${dated[1]} belongs in ` +
        `${ARCHIVE}/${dated[1]}.md; that month is archived, up to ${newest}`,
    );
});

if (problems.length) {
  for (const p of problems) console.error(p);
  process.exit(1);
}
console.log(
  `${LOG}: ${count} of ${CAP} lines; archived: ${months.join(", ") || "none"}`,
);
