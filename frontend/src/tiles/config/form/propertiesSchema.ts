import type { FieldType } from './inferType'

export interface PropSchema {
  section: string
  label: string
  type: FieldType
  description?: string
  options?: string[]
  min?: number
  max?: number
}

export const PROPERTIES_SCHEMA: Record<string, PropSchema> = {
  // General
  'server-ip': {
    section: 'General',
    label: 'Server IP',
    type: 'string',
    description: 'The IP address to bind. Leave blank to bind all interfaces.',
  },
  'server-port': { section: 'General', label: 'Server Port', type: 'number', min: 1, max: 65535 },
  'server-name': { section: 'General', label: 'Server Name', type: 'string' },
  motd: {
    section: 'General',
    label: 'MOTD',
    type: 'motd',
    description: 'Message shown in the server list. Supports §-codes.',
  },
  'max-players': {
    section: 'General',
    label: 'Max Players',
    type: 'number',
    min: 0,
    max: 2147483647,
  },
  'online-mode': {
    section: 'General',
    label: 'Online Mode',
    type: 'boolean',
    description: 'Authenticate players with Mojang. Disable for offline/LAN play.',
  },
  'white-list': {
    section: 'General',
    label: 'Whitelist',
    type: 'boolean',
    description: 'Only allow players on the whitelist to join.',
  },
  'enforce-whitelist': {
    section: 'General',
    label: 'Enforce Whitelist',
    type: 'boolean',
    description: 'Kick players not on the whitelist when enabled mid-session.',
  },

  // Gameplay
  gamemode: {
    section: 'Gameplay',
    label: 'Default Gamemode',
    type: 'enum',
    options: ['survival', 'creative', 'adventure', 'spectator'],
  },
  'force-gamemode': {
    section: 'Gameplay',
    label: 'Force Gamemode',
    type: 'boolean',
    description: 'Reset players to the default gamemode on join.',
  },
  difficulty: {
    section: 'Gameplay',
    label: 'Difficulty',
    type: 'enum',
    options: ['peaceful', 'easy', 'normal', 'hard'],
  },
  hardcore: {
    section: 'Gameplay',
    label: 'Hardcore Mode',
    type: 'boolean',
    description: 'Players are permanently banned on death.',
  },
  pvp: {
    section: 'Gameplay',
    label: 'PvP',
    type: 'boolean',
    description: 'Allow players to damage each other.',
  },
  'allow-flight': {
    section: 'Gameplay',
    label: 'Allow Flight',
    type: 'boolean',
    description: 'Allow flight in survival mode. Required for some plugins.',
  },
  'allow-nether': { section: 'Gameplay', label: 'Allow Nether', type: 'boolean' },
  'enable-command-block': { section: 'Gameplay', label: 'Command Blocks', type: 'boolean' },
  'spawn-animals': { section: 'Gameplay', label: 'Spawn Animals', type: 'boolean' },
  'spawn-monsters': { section: 'Gameplay', label: 'Spawn Monsters', type: 'boolean' },
  'spawn-npcs': { section: 'Gameplay', label: 'Spawn Villagers', type: 'boolean' },
  'spawn-protection': {
    section: 'Gameplay',
    label: 'Spawn Protection Radius',
    type: 'number',
    min: 0,
    description: 'Radius in blocks around spawn that non-ops cannot build in. 0 = disabled.',
  },
  'max-world-size': {
    section: 'Gameplay',
    label: 'Max World Radius',
    type: 'number',
    min: 1,
    max: 29999984,
  },

  // World
  'level-name': { section: 'World', label: 'World Name', type: 'string' },
  'level-seed': {
    section: 'World',
    label: 'Seed',
    type: 'string',
    description: 'World generation seed. Leave blank for random.',
  },
  'level-type': {
    section: 'World',
    label: 'World Type',
    type: 'enum',
    options: [
      'minecraft:normal',
      'minecraft:flat',
      'minecraft:large_biomes',
      'minecraft:amplified',
      'minecraft:single_biome_surface',
    ],
  },
  'generate-structures': {
    section: 'World',
    label: 'Generate Structures',
    type: 'boolean',
    description: 'Generate villages, dungeons, and other structures.',
  },
  'generator-settings': {
    section: 'World',
    label: 'Generator Settings',
    type: 'string',
    description: 'JSON string for flat/custom world generation.',
  },
  'view-distance': {
    section: 'World',
    label: 'View Distance',
    type: 'number',
    min: 2,
    max: 32,
    description: 'Chunk render distance sent to clients.',
  },
  'simulation-distance': {
    section: 'World',
    label: 'Simulation Distance',
    type: 'number',
    min: 2,
    max: 32,
    description: 'Chunk tick/simulation distance.',
  },

  // Performance
  'max-tick-time': {
    section: 'Performance',
    label: 'Max Tick Time (ms)',
    type: 'number',
    min: -1,
    description: 'Watchdog kills the server if a tick takes longer. -1 to disable.',
  },
  'entity-broadcast-range-percentage': {
    section: 'Performance',
    label: 'Entity Broadcast Range %',
    type: 'number',
    min: 10,
    max: 1000,
  },
  'network-compression-threshold': {
    section: 'Performance',
    label: 'Network Compression Threshold',
    type: 'number',
    min: -1,
    description: 'Compress packets larger than this (bytes). -1 to disable, 0 to compress all.',
  },
  'op-permission-level': {
    section: 'Performance',
    label: 'OP Permission Level',
    type: 'enum',
    options: ['1', '2', '3', '4'],
  },
  'function-permission-level': {
    section: 'Performance',
    label: 'Function Permission Level',
    type: 'enum',
    options: ['1', '2', '3', '4'],
  },
  'max-chained-neighbor-updates': {
    section: 'Performance',
    label: 'Max Chained Neighbor Updates',
    type: 'number',
    description: 'Limits chain reaction block updates. Negative = unlimited.',
  },
  'rate-limit': {
    section: 'Performance',
    label: 'Packet Rate Limit',
    type: 'number',
    min: 0,
    description: 'Max packets per second per player. 0 = unlimited.',
  },

  // Network
  'enable-status': {
    section: 'Network',
    label: 'Show in Server List',
    type: 'boolean',
    description: 'Respond to server list pings.',
  },
  'max-players-status': { section: 'Network', label: 'Show Player Count', type: 'boolean' },
  'prevent-proxy-connections': {
    section: 'Network',
    label: 'Block VPN/Proxy Connections',
    type: 'boolean',
  },
  'player-idle-timeout': {
    section: 'Network',
    label: 'Player Idle Timeout (min)',
    type: 'number',
    min: 0,
    description: 'Kick idle players after this many minutes. 0 = disabled.',
  },

  // Security
  'enforce-secure-profile': {
    section: 'Security',
    label: 'Enforce Secure Profile',
    type: 'boolean',
    description: 'Require players to have a verified Mojang public key.',
  },
  'hide-online-players': {
    section: 'Security',
    label: 'Hide Online Players',
    type: 'boolean',
    description: 'Hide the player list from server-list pings.',
  },
  'enable-jmx-monitoring': { section: 'Security', label: 'JMX Monitoring', type: 'boolean' },

  // RCON & Query
  'enable-rcon': { section: 'RCON & Query', label: 'Enable RCON', type: 'boolean' },
  'rcon.port': { section: 'RCON & Query', label: 'RCON Port', type: 'number', min: 1, max: 65535 },
  'rcon.password': { section: 'RCON & Query', label: 'RCON Password', type: 'string' },
  'enable-query': {
    section: 'RCON & Query',
    label: 'Enable Query',
    type: 'boolean',
    description: 'GameSpy4 protocol server listener.',
  },
  'query.port': {
    section: 'RCON & Query',
    label: 'Query Port',
    type: 'number',
    min: 1,
    max: 65535,
  },
  'broadcast-rcon-to-ops': {
    section: 'RCON & Query',
    label: 'Broadcast RCON to Ops',
    type: 'boolean',
  },
  'broadcast-console-to-ops': {
    section: 'RCON & Query',
    label: 'Broadcast Console to Ops',
    type: 'boolean',
  },

  // Resource Pack
  'resource-pack': {
    section: 'Resource Pack',
    label: 'URL',
    type: 'string',
    description: 'URL to a resource pack .zip to send to clients on join.',
  },
  'resource-pack-sha1': { section: 'Resource Pack', label: 'SHA-1 Hash', type: 'string' },
  'resource-pack-prompt': { section: 'Resource Pack', label: 'Prompt Message', type: 'string' },
  'require-resource-pack': {
    section: 'Resource Pack',
    label: 'Require Resource Pack',
    type: 'boolean',
    description: 'Kick players who decline the resource pack.',
  },
  'resource-pack-id': { section: 'Resource Pack', label: 'Pack ID (UUID)', type: 'string' },

  // Misc
  'enable-hardcore': { section: 'Gameplay', label: 'Hardcore', type: 'boolean' },
  'accepts-transfers': {
    section: 'Network',
    label: 'Accept Transfers',
    type: 'boolean',
    description: 'Accept incoming player transfers from other servers (1.20.5+).',
  },
  'log-ips': { section: 'Security', label: 'Log Player IPs', type: 'boolean' },
  'pause-when-empty-seconds': {
    section: 'Performance',
    label: 'Pause When Empty (s)',
    type: 'number',
    min: -1,
    description: 'Pause the server when no players are online. -1 = disabled (1.21.4+).',
  },
  'initial-enabled-packs': { section: 'World', label: 'Initial Enabled Packs', type: 'string' },
  'initial-disabled-packs': { section: 'World', label: 'Initial Disabled Packs', type: 'string' },
  'text-filtering-config': { section: 'Security', label: 'Text Filtering Config', type: 'string' },
}

export const SECTION_ORDER = [
  'General',
  'Gameplay',
  'World',
  'Performance',
  'Network',
  'Security',
  'RCON & Query',
  'Resource Pack',
  'Other',
]
