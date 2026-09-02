/* Modrinth, for real, from the browser.
 *
 * The API sends `Access-Control-Allow-Origin: *` and needs no key, so browse
 * and search are genuinely live here rather than fixtures — the one part of
 * the demo that talks to the outside world.
 *
 * What cannot be reproduced: backend/services/modrinth.go sends
 * `User-Agent: Konnekt/0.1 (github.com/kollektiv-mc/konnekt)`, and User-Agent
 * is a forbidden header name in fetch — the browser sends its own and refuses
 * to let a page override it. Modrinth asks callers to identify themselves, so
 * this is the one behaviour the demo cannot match. If they ever start refusing
 * browser user agents, `search` below fails and the Browse panel says so; it
 * does not fall back to fixtures pretending to be Modrinth.
 *
 * A rate-limited response is worse than a failure: Modrinth's 429 omits the
 * CORS header, so the browser hands the page a network error with no status at
 * all. Everything here therefore treats "no answer" as one state — the caller
 * cannot tell 429 from offline, and pretending otherwise would be a lie.
 *
 * Shapes are converted to the same camelCase models the Go client produces
 * (mrHitToProject / mrProjectToModel / mrVersionToModel), because the tile is
 * typed against those and knows nothing about Modrinth's snake_case wire.
 */

const BASE = "https://api.modrinth.com/v2";

async function get(path, params) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, v);
  }
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`modrinth: HTTP ${res.status}`);
  return res.json();
}

/* Mirrors buildFacets in modrinth.go. The demo server is Paper on 1.21.1, so
   project_type is "plugin" and the loader joins as a category facet — get this
   wrong and every search returns mods that cannot run on the server. */
function facets(loader, mcVersion) {
  const PLUGIN_LOADERS = ["paper", "spigot", "bukkit", "purpur", "velocity"];
  const isPlugin = PLUGIN_LOADERS.includes(loader);
  const groups = [[`project_type:${isPlugin ? "plugin" : "mod"}`]];
  if (loader && loader !== "vanilla") groups.push([`categories:${loader}`]);
  if (mcVersion) groups.push([`versions:${mcVersion}`]);
  return JSON.stringify(groups);
}

const hitToProject = (h) => ({
  id: h.project_id,
  slug: h.slug,
  title: h.title,
  description: h.description,
  body: "",
  iconUrl: h.icon_url ?? "",
  author: h.author ?? "",
  projectType: h.project_type ?? "",
  downloads: h.downloads ?? 0,
  follows: h.follows ?? 0,
  dateModified: h.date_modified ?? "",
  categories: h.categories ?? [],
  gallery: [],
});

const versionToModel = (v) => {
  const file =
    (v.files ?? []).find((f) => f.primary) ?? (v.files ?? [])[0] ?? {};
  return {
    id: v.id,
    projectId: v.project_id,
    name: v.name,
    versionNumber: v.version_number,
    versionType: v.version_type,
    gameVersions: v.game_versions ?? [],
    loaders: v.loaders ?? [],
    fileName: file.filename ?? "",
    fileUrl: file.url ?? "",
    sha512: file.hashes?.sha512 ?? "",
    fileSize: file.size ?? 0,
    dependencies: (v.dependencies ?? []).map((d) => ({
      projectId: d.project_id ?? "",
      versionId: d.version_id ?? "",
      dependencyType: d.dependency_type ?? "",
    })),
    datePublished: v.date_published ?? "",
  };
};

export async function search(
  query,
  offset,
  categories,
  sort,
  loader,
  mcVersion,
) {
  const groups = JSON.parse(facets(loader, mcVersion));
  for (const c of categories ?? []) groups.push([`categories:${c}`]);

  const data = await get("/search", {
    query: query ?? "",
    limit: 20,
    offset: offset ?? 0,
    facets: JSON.stringify(groups),
    // The Go side validates against this same set and omits anything else.
    index: ["relevance", "newest", "updated", "downloads", "follows"].includes(
      sort,
    )
      ? sort
      : "",
  });

  return {
    hits: (data.hits ?? []).map(hitToProject),
    total: data.total_hits ?? 0,
    offset: data.offset ?? 0,
  };
}

export async function getProject(projectID) {
  const p = await get(`/project/${encodeURIComponent(projectID)}`);
  // The Go client resolves the owning member's username for the byline; one
  // extra request, and a failure only costs the author's name.
  let author = "";
  try {
    const members = await get(
      `/project/${encodeURIComponent(projectID)}/members`,
    );
    const owner = members.find((m) => m.role === "Owner") ?? members[0];
    author = owner?.user?.username ?? "";
  } catch {
    /* the byline is not worth failing the panel for */
  }
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    body: p.body ?? "",
    iconUrl: p.icon_url ?? "",
    author,
    projectType: p.project_type ?? "",
    downloads: p.downloads ?? 0,
    follows: p.followers ?? 0,
    dateModified: p.updated ?? "",
    categories: p.categories ?? [],
    gallery: (p.gallery ?? []).map((g) => ({
      url: g.url,
      title: g.title ?? "",
      description: g.description ?? "",
      featured: !!g.featured,
    })),
  };
}

export async function getVersions(projectID, loader, mcVersion) {
  const data = await get(`/project/${encodeURIComponent(projectID)}/version`, {
    game_versions: mcVersion ? JSON.stringify([mcVersion]) : "",
    loaders: loader ? JSON.stringify([loader]) : "",
  });
  return data.map(versionToModel);
}

export async function getAllVersions(projectID) {
  const data = await get(`/project/${encodeURIComponent(projectID)}/version`);
  return data.map(versionToModel);
}

export async function categories(loader) {
  const all = await get("/tag/category");
  const PLUGIN_LOADERS = ["paper", "spigot", "bukkit", "purpur", "velocity"];
  // The Go side falls back to mod categories for plugin loaders, which is what
  // Modrinth actually tags plugins with.
  const wanted = PLUGIN_LOADERS.includes(loader) ? "mod" : "mod";
  return all
    .filter((c) => c.header === "categories" && c.project_type === wanted)
    .map((c) => c.name);
}

export async function moreByAuthor(username, excludeProjectID, loader) {
  if (!username) return [];
  const all = await get(`/user/${encodeURIComponent(username)}/projects`);
  const PLUGIN_LOADERS = ["paper", "spigot", "bukkit", "purpur", "velocity"];
  const type = PLUGIN_LOADERS.includes(loader) ? "plugin" : "mod";
  return all
    .filter((p) => p.project_type === type && p.id !== excludeProjectID)
    .slice(0, 6) // the Go side caps at six
    .map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      description: p.description,
      body: "",
      iconUrl: p.icon_url ?? "",
      author: username,
      projectType: p.project_type ?? "",
      downloads: p.downloads ?? 0,
      follows: p.followers ?? 0,
      dateModified: p.updated ?? "",
      categories: p.categories ?? [],
      gallery: [],
    }));
}
