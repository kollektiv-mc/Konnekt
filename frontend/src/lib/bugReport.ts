const BUG_REPORT_URL = 'https://github.com/kollektiv-mc/Konnekt/issues/new?template=bug_report.yml'

/**
 * The bug form, with the version filled in: the form's field ids double as
 * query parameters (.github/ISSUE_TEMPLATE/bug_report.yml).
 */
export function bugReportUrl(version: string | null): string {
  return version ? `${BUG_REPORT_URL}&app-version=${encodeURIComponent(version)}` : BUG_REPORT_URL
}
