/* What's New, as GetReleaseNotes answers it: the releases up to this build,
 * each release body's "## What's changed" section split at its headings.
 *
 * Fixed rather than fetched. The app asks GitHub from Go, and the demo carries
 * the app's Content-Security-Policy, whose default-src 'self' refuses a
 * fetch to api.github.com from the page. These are two real releases, trimmed;
 * the second has hand-written notes and so no sections, which is the state
 * where the pane links the release instead.
 */

const RELEASES = "https://github.com/kollektiv-mc/Konnekt/releases/tag/";

export const RELEASE_NOTES = {
  fetchedAt: "2026-10-21T18:00:00Z",
  stale: false,
  releases: [
    {
      version: "v0.2.0-alpha.2",
      snapshot: false,
      url: RELEASES + "v0.2.0-alpha.2",
      publishedAt: "2026-10-01T08:56:39Z",
      sections: [
        {
          title: "Features",
          items: [
            "Rework the Commands tile around commands linked from Kommands",
            "Bind Backspace as a delete key in the graph editor",
            "Give tiles figure-first faces with three layouts and a header menu",
            "Warn before installing a client-only mod on a server",
          ],
        },
        {
          title: "Fixes",
          items: [
            "Back up every dimension of a world, not just the overworld",
            "Run each schedule against the server it was written for",
            "Refuse mod downloads that cannot be verified",
          ],
        },
      ],
    },
    {
      version: "v0.1.0-alpha.1",
      snapshot: false,
      url: RELEASES + "v0.1.0-alpha.1",
      publishedAt: "2026-07-16T18:51:55Z",
      sections: [],
    },
  ],
};
