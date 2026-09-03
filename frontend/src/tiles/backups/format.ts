// Size and date formatting used to live here too, in a copy that stopped at
// MB and rendered a 4 GiB zip as "4096.0 MB". Those are lib/format.ts's
// fmtBytes and fmtDate now (#260); only the filename rule is backup-specific.
export function extractID(filename: string): string {
  const m = filename.match(/^(\d{5})_/)
  return m ? m[1] : filename.replace('.zip', '')
}
