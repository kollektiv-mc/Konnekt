export namespace models {
	
	export class AppSettings {
	    theme: string;
	    skinId: string;
	    accentColor: string;
	    successColor: string;
	    warningColor: string;
	    dangerColor: string;
	    backgroundStyle: string;
	    autoStartActiveServer: boolean;
	    confirmBeforeStop: boolean;
	    consoleBufferLines: number;
	    consoleTimestamps: boolean;
	    notifyOnCrash: boolean;
	    notifyOnJoin: boolean;
	    schedulerPaletteCollapsed: boolean;
	    schedulerPaletteClosedCategories: Record<string, boolean>;
	    consoleQuickCommandsCollapsed: boolean;
	    checkUpdatesOnStartup: boolean;
	    crateOrder: string[];
	
	    static createFrom(source: any = {}) {
	        return new AppSettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.theme = source["theme"];
	        this.skinId = source["skinId"];
	        this.accentColor = source["accentColor"];
	        this.successColor = source["successColor"];
	        this.warningColor = source["warningColor"];
	        this.dangerColor = source["dangerColor"];
	        this.backgroundStyle = source["backgroundStyle"];
	        this.autoStartActiveServer = source["autoStartActiveServer"];
	        this.confirmBeforeStop = source["confirmBeforeStop"];
	        this.consoleBufferLines = source["consoleBufferLines"];
	        this.consoleTimestamps = source["consoleTimestamps"];
	        this.notifyOnCrash = source["notifyOnCrash"];
	        this.notifyOnJoin = source["notifyOnJoin"];
	        this.schedulerPaletteCollapsed = source["schedulerPaletteCollapsed"];
	        this.schedulerPaletteClosedCategories = source["schedulerPaletteClosedCategories"];
	        this.consoleQuickCommandsCollapsed = source["consoleQuickCommandsCollapsed"];
	        this.checkUpdatesOnStartup = source["checkUpdatesOnStartup"];
	        this.crateOrder = source["crateOrder"];
	    }
	}
	export class AttrValue {
	    name: string;
	    value: string;
	    type: string;
	    writable: boolean;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new AttrValue(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.value = source["value"];
	        this.type = source["type"];
	        this.writable = source["writable"];
	        this.error = source["error"];
	    }
	}
	export class Backup {
	    filename: string;
	    createdAt: number;
	    sizeBytes: number;
	    displayName: string;
	    tags: string[];
	    kind: string;
	    world?: string;
	
	    static createFrom(source: any = {}) {
	        return new Backup(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.filename = source["filename"];
	        this.createdAt = source["createdAt"];
	        this.sizeBytes = source["sizeBytes"];
	        this.displayName = source["displayName"];
	        this.tags = source["tags"];
	        this.kind = source["kind"];
	        this.world = source["world"];
	    }
	}
	export class FieldOption {
	    label: string;
	    value: string;
	
	    static createFrom(source: any = {}) {
	        return new FieldOption(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.label = source["label"];
	        this.value = source["value"];
	    }
	}
	export class ConfigField {
	    key: string;
	    label: string;
	    type: string;
	    default?: any;
	    required?: boolean;
	    options?: FieldOption[];
	
	    static createFrom(source: any = {}) {
	        return new ConfigField(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.label = source["label"];
	        this.type = source["type"];
	        this.default = source["default"];
	        this.required = source["required"];
	        this.options = this.convertValues(source["options"], FieldOption);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DataPort {
	    id: string;
	    label: string;
	    type: string;
	
	    static createFrom(source: any = {}) {
	        return new DataPort(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.type = source["type"];
	    }
	}
	export class BlockDef {
	    id: string;
	    category: string;
	    label: string;
	    description: string;
	    isTrigger: boolean;
	    controlInputs: string[];
	    controlOutputs: string[];
	    dataInputs: DataPort[];
	    dataOutputs: DataPort[];
	    configSchema: ConfigField[];
	    source: string;
	    primitive?: string;
	
	    static createFrom(source: any = {}) {
	        return new BlockDef(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.category = source["category"];
	        this.label = source["label"];
	        this.description = source["description"];
	        this.isTrigger = source["isTrigger"];
	        this.controlInputs = source["controlInputs"];
	        this.controlOutputs = source["controlOutputs"];
	        this.dataInputs = this.convertValues(source["dataInputs"], DataPort);
	        this.dataOutputs = this.convertValues(source["dataOutputs"], DataPort);
	        this.configSchema = this.convertValues(source["configSchema"], ConfigField);
	        this.source = source["source"];
	        this.primitive = source["primitive"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class ConfigFile {
	    relPath: string;
	    name: string;
	    category: string;
	    source: string;
	    format: string;
	    sizeBytes: number;
	    modified: number;
	
	    static createFrom(source: any = {}) {
	        return new ConfigFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.relPath = source["relPath"];
	        this.name = source["name"];
	        this.category = source["category"];
	        this.source = source["source"];
	        this.format = source["format"];
	        this.sizeBytes = source["sizeBytes"];
	        this.modified = source["modified"];
	    }
	}
	export class ConsoleLine {
	    timestamp: string;
	    line: string;
	
	    static createFrom(source: any = {}) {
	        return new ConsoleLine(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.timestamp = source["timestamp"];
	        this.line = source["line"];
	    }
	}
	
	export class Edge {
	    id: string;
	    kind: string;
	    source: string;
	    sourcePort: string;
	    target: string;
	    targetPort: string;
	
	    static createFrom(source: any = {}) {
	        return new Edge(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.kind = source["kind"];
	        this.source = source["source"];
	        this.sourcePort = source["sourcePort"];
	        this.target = source["target"];
	        this.targetPort = source["targetPort"];
	    }
	}
	
	export class Position {
	    x: number;
	    y: number;
	
	    static createFrom(source: any = {}) {
	        return new Position(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.x = source["x"];
	        this.y = source["y"];
	    }
	}
	export class Node {
	    id: string;
	    type: string;
	    config: Record<string, any>;
	    position: Position;
	
	    static createFrom(source: any = {}) {
	        return new Node(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.type = source["type"];
	        this.config = source["config"];
	        this.position = this.convertValues(source["position"], Position);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Graph {
	    id: string;
	    name: string;
	    enabled: boolean;
	    nodes: Node[];
	    edges: Edge[];
	    createdAt: number;
	    updatedAt: number;
	
	    static createFrom(source: any = {}) {
	        return new Graph(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.enabled = source["enabled"];
	        this.nodes = this.convertValues(source["nodes"], Node);
	        this.edges = this.convertValues(source["edges"], Edge);
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class InstalledMod {
	    fileName: string;
	    displayName: string;
	    iconUrl: string;
	    modId: string;
	    source: string;
	    provider: string;
	    projectId: string;
	    versionId: string;
	    versionNumber: string;
	    loader: string;
	    targetFolder: string;
	    enabled: boolean;
	    sizeBytes: number;
	    installedAt: number;
	
	    static createFrom(source: any = {}) {
	        return new InstalledMod(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.fileName = source["fileName"];
	        this.displayName = source["displayName"];
	        this.iconUrl = source["iconUrl"];
	        this.modId = source["modId"];
	        this.source = source["source"];
	        this.provider = source["provider"];
	        this.projectId = source["projectId"];
	        this.versionId = source["versionId"];
	        this.versionNumber = source["versionNumber"];
	        this.loader = source["loader"];
	        this.targetFolder = source["targetFolder"];
	        this.enabled = source["enabled"];
	        this.sizeBytes = source["sizeBytes"];
	        this.installedAt = source["installedAt"];
	    }
	}
	export class LayoutPreset {
	    name: string;
	    layout: string;
	
	    static createFrom(source: any = {}) {
	        return new LayoutPreset(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.layout = source["layout"];
	    }
	}
	export class ModDependency {
	    projectId: string;
	    versionId: string;
	    dependencyType: string;
	
	    static createFrom(source: any = {}) {
	        return new ModDependency(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.projectId = source["projectId"];
	        this.versionId = source["versionId"];
	        this.dependencyType = source["dependencyType"];
	    }
	}
	export class ModGalleryImg {
	    url: string;
	    title: string;
	    description: string;
	    featured: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ModGalleryImg(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.url = source["url"];
	        this.title = source["title"];
	        this.description = source["description"];
	        this.featured = source["featured"];
	    }
	}
	export class ModProject {
	    id: string;
	    slug: string;
	    title: string;
	    description: string;
	    body: string;
	    iconUrl: string;
	    author: string;
	    projectType: string;
	    downloads: number;
	    follows: number;
	    dateModified: string;
	    categories: string[];
	    gallery: ModGalleryImg[];
	
	    static createFrom(source: any = {}) {
	        return new ModProject(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.slug = source["slug"];
	        this.title = source["title"];
	        this.description = source["description"];
	        this.body = source["body"];
	        this.iconUrl = source["iconUrl"];
	        this.author = source["author"];
	        this.projectType = source["projectType"];
	        this.downloads = source["downloads"];
	        this.follows = source["follows"];
	        this.dateModified = source["dateModified"];
	        this.categories = source["categories"];
	        this.gallery = this.convertValues(source["gallery"], ModGalleryImg);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ModSearchResult {
	    hits: ModProject[];
	    total: number;
	    offset: number;
	
	    static createFrom(source: any = {}) {
	        return new ModSearchResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hits = this.convertValues(source["hits"], ModProject);
	        this.total = source["total"];
	        this.offset = source["offset"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ModUpdateInfo {
	    fileName: string;
	    updateAvailable: boolean;
	    latestVersionId: string;
	    latestVersionNumber: string;
	
	    static createFrom(source: any = {}) {
	        return new ModUpdateInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.fileName = source["fileName"];
	        this.updateAvailable = source["updateAvailable"];
	        this.latestVersionId = source["latestVersionId"];
	        this.latestVersionNumber = source["latestVersionNumber"];
	    }
	}
	export class ModVersion {
	    id: string;
	    projectId: string;
	    name: string;
	    versionNumber: string;
	    versionType: string;
	    gameVersions: string[];
	    loaders: string[];
	    fileName: string;
	    fileUrl: string;
	    sha512: string;
	    fileSize: number;
	    dependencies: ModDependency[];
	    datePublished: string;
	
	    static createFrom(source: any = {}) {
	        return new ModVersion(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.projectId = source["projectId"];
	        this.name = source["name"];
	        this.versionNumber = source["versionNumber"];
	        this.versionType = source["versionType"];
	        this.gameVersions = source["gameVersions"];
	        this.loaders = source["loaders"];
	        this.fileName = source["fileName"];
	        this.fileUrl = source["fileUrl"];
	        this.sha512 = source["sha512"];
	        this.fileSize = source["fileSize"];
	        this.dependencies = this.convertValues(source["dependencies"], ModDependency);
	        this.datePublished = source["datePublished"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class NodePreview {
	    nodeId: string;
	    attributes: AttrValue[];
	    console: string[];
	    ok: boolean;
	
	    static createFrom(source: any = {}) {
	        return new NodePreview(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.nodeId = source["nodeId"];
	        this.attributes = this.convertValues(source["attributes"], AttrValue);
	        this.console = source["console"];
	        this.ok = source["ok"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class NodeRunRecord {
	    nodeId: string;
	    type: string;
	    status: string;
	    firedPort: string;
	    startedAt: number;
	    finishedAt: number;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new NodeRunRecord(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.nodeId = source["nodeId"];
	        this.type = source["type"];
	        this.status = source["status"];
	        this.firedPort = source["firedPort"];
	        this.startedAt = source["startedAt"];
	        this.finishedAt = source["finishedAt"];
	        this.error = source["error"];
	    }
	}
	export class Player {
	    name: string;
	    uuid: string;
	    online: boolean;
	    ip: string;
	    lastOnline: number;
	    opLevel: number;
	    whitelisted: boolean;
	    banned: boolean;
	    banReason: string;
	    primaryGroup: string;
	    groups: string[];
	
	    static createFrom(source: any = {}) {
	        return new Player(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.uuid = source["uuid"];
	        this.online = source["online"];
	        this.ip = source["ip"];
	        this.lastOnline = source["lastOnline"];
	        this.opLevel = source["opLevel"];
	        this.whitelisted = source["whitelisted"];
	        this.banned = source["banned"];
	        this.banReason = source["banReason"];
	        this.primaryGroup = source["primaryGroup"];
	        this.groups = source["groups"];
	    }
	}
	
	export class ResolvedDependency {
	    projectId: string;
	    projectTitle: string;
	    version: ModVersion;
	    required: boolean;
	    alreadyInstalled: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ResolvedDependency(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.projectId = source["projectId"];
	        this.projectTitle = source["projectTitle"];
	        this.version = this.convertValues(source["version"], ModVersion);
	        this.required = source["required"];
	        this.alreadyInstalled = source["alreadyInstalled"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class RunRecord {
	    id: string;
	    graphId: string;
	    graphName: string;
	    trigger: string;
	    startedAt: number;
	    finishedAt: number;
	    status: string;
	    error?: string;
	    nodes: NodeRunRecord[];
	
	    static createFrom(source: any = {}) {
	        return new RunRecord(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.graphId = source["graphId"];
	        this.graphName = source["graphName"];
	        this.trigger = source["trigger"];
	        this.startedAt = source["startedAt"];
	        this.finishedAt = source["finishedAt"];
	        this.status = source["status"];
	        this.error = source["error"];
	        this.nodes = this.convertValues(source["nodes"], NodeRunRecord);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ServerConfig {
	    id: string;
	    name: string;
	    jarPath: string;
	    jvmArgs: string[];
	    workingDir: string;
	    mcVersion: string;
	    loader: string;
	
	    static createFrom(source: any = {}) {
	        return new ServerConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.jarPath = source["jarPath"];
	        this.jvmArgs = source["jvmArgs"];
	        this.workingDir = source["workingDir"];
	        this.mcVersion = source["mcVersion"];
	        this.loader = source["loader"];
	    }
	}
	export class ServerStatus {
	    running: boolean;
	    state: string;
	    uptime: string;
	    players: number;
	    maxPlayers: number;
	    tps: number;
	    ramUsed: number;
	    ramTotal: number;
	
	    static createFrom(source: any = {}) {
	        return new ServerStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.running = source["running"];
	        this.state = source["state"];
	        this.uptime = source["uptime"];
	        this.players = source["players"];
	        this.maxPlayers = source["maxPlayers"];
	        this.tps = source["tps"];
	        this.ramUsed = source["ramUsed"];
	        this.ramTotal = source["ramTotal"];
	    }
	}
	export class ServerStopped {
	    expected: boolean;
	    exitCode: number;
	
	    static createFrom(source: any = {}) {
	        return new ServerStopped(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.expected = source["expected"];
	        this.exitCode = source["exitCode"];
	    }
	}
	export class ServerSummary {
	    mcVersion: string;
	    loader: string;
	    workingDir: string;
	    launchFile: string;
	    running: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ServerSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mcVersion = source["mcVersion"];
	        this.loader = source["loader"];
	        this.workingDir = source["workingDir"];
	        this.launchFile = source["launchFile"];
	        this.running = source["running"];
	    }
	}
	export class StatsSnapshot {
	    timestamp: number;
	    tps: number;
	    ramUsedMB: number;
	    ramTotalMB: number;
	    cpuPercent: number;
	    players: number;
	
	    static createFrom(source: any = {}) {
	        return new StatsSnapshot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.timestamp = source["timestamp"];
	        this.tps = source["tps"];
	        this.ramUsedMB = source["ramUsedMB"];
	        this.ramTotalMB = source["ramTotalMB"];
	        this.cpuPercent = source["cpuPercent"];
	        this.players = source["players"];
	    }
	}
	export class UpdateAsset {
	    name: string;
	    downloadUrl: string;
	    size: number;
	
	    static createFrom(source: any = {}) {
	        return new UpdateAsset(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.downloadUrl = source["downloadUrl"];
	        this.size = source["size"];
	    }
	}
	export class UpdateInfo {
	    currentVersion: string;
	    latestVersion: string;
	    updateAvailable: boolean;
	    releaseUrl: string;
	    releaseNotes: string;
	    publishedAt: string;
	    assets: UpdateAsset[];
	
	    static createFrom(source: any = {}) {
	        return new UpdateInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.currentVersion = source["currentVersion"];
	        this.latestVersion = source["latestVersion"];
	        this.updateAvailable = source["updateAvailable"];
	        this.releaseUrl = source["releaseUrl"];
	        this.releaseNotes = source["releaseNotes"];
	        this.publishedAt = source["publishedAt"];
	        this.assets = this.convertValues(source["assets"], UpdateAsset);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class WorldDimension {
	    kind: string;
	    path: string;
	    size: number;
	    modified: number;
	
	    static createFrom(source: any = {}) {
	        return new WorldDimension(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.path = source["path"];
	        this.size = source["size"];
	        this.modified = source["modified"];
	    }
	}
	export class WorldMeta {
	    found: boolean;
	    levelName: string;
	    version: string;
	    gameMode: string;
	    difficulty: string;
	    hardcore: boolean;
	    lastPlayed: number;
	    seed: string;
	    spawnX: number;
	    spawnY: number;
	    spawnZ: number;
	
	    static createFrom(source: any = {}) {
	        return new WorldMeta(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.found = source["found"];
	        this.levelName = source["levelName"];
	        this.version = source["version"];
	        this.gameMode = source["gameMode"];
	        this.difficulty = source["difficulty"];
	        this.hardcore = source["hardcore"];
	        this.lastPlayed = source["lastPlayed"];
	        this.seed = source["seed"];
	        this.spawnX = source["spawnX"];
	        this.spawnY = source["spawnY"];
	        this.spawnZ = source["spawnZ"];
	    }
	}
	export class WorldSystem {
	    name: string;
	    active: boolean;
	    totalSize: number;
	    modified: number;
	    dimensions: WorldDimension[];
	    meta: WorldMeta;
	
	    static createFrom(source: any = {}) {
	        return new WorldSystem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.active = source["active"];
	        this.totalSize = source["totalSize"];
	        this.modified = source["modified"];
	        this.dimensions = this.convertValues(source["dimensions"], WorldDimension);
	        this.meta = this.convertValues(source["meta"], WorldMeta);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace services {
	
	export class InstallerInfo {
	    isInstaller: boolean;
	    loader: string;
	    version: string;
	    mcVersion: string;
	
	    static createFrom(source: any = {}) {
	        return new InstallerInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.isInstaller = source["isInstaller"];
	        this.loader = source["loader"];
	        this.version = source["version"];
	        this.mcVersion = source["mcVersion"];
	    }
	}

}

