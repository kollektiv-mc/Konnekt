// Size and date formatting used to live here too, as copies of lib/format.ts
// that stopped at MB (a 4 GiB zip read "4096.0 MB"). They are gone; import
// fmtBytes and fmtDate from lib/format instead (#260).
export function extractID(filename: string): string {
  const m = filename.match(/^(\d{5})_/)
  return m ? m[1] : filename.replace('.zip', '')
}
