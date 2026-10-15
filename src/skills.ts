import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface Skill {
  /** folder name, e.g. "john-woo" */
  id: string;
  /** title from the first "# ..." heading, e.g. "John Woo" */
  title: string;
  /** the identity line: "You are John Woo, ..." */
  identity: string;
  /** full raw SKILL.md contents */
  raw: string;
  /** frontmatter description (the long persona blurb) if present */
  description: string;
  /** path to the source file on disk */
  path: string;
  /** persona category derived from our known-id sets */
  category: 'director' | 'actor' | 'other';
  /** true if this is a director OR actor persona we surface prominently */
  isFilmmaker: boolean;
}

const REPO_URL = 'https://github.com/mrfentmen/skills-2.git';

/** Where we cache the cloned repo. Override with SKILLS_REPO_DIR. */
const CACHE_ROOT = process.env.SKILLS_CACHE_DIR || join(process.cwd(), '.cache');
const REPO_DIR = process.env.SKILLS_REPO_DIR || join(CACHE_ROOT, 'skills-2');

/**
 * Director personas — surfaced by list_directors and marked isFilmmaker=true.
 * Keys are folder ids.
 */
const DIRECTOR_IDS = new Set<string>([
  // original + first batch
  'james-cameron',
  'walt-disney',
  'john-woo',
  'wong-kar-wai',
  'tarantino',
  'kubrick',
  'nolan',
  // directors batch
  'hitchcock',
  'fincher',
  'kurosawa',
  'spielberg',
  'orson-welles',
  'george-miller',
  'jordan-peele',
  'ang-lee',
  'david-lynch',
]);

/**
 * Actor personas — performance/inhabitation disciplines. Surfaced by list_actors
 * and also marked isFilmmaker=true so they show up alongside directors.
 */
const ACTOR_IDS = new Set<string>([
  'jackie-chan',
  'daniel-day-lewis',
  'meryl-streep',
  'denzel-washington',
  'al-pacino',
  'brad-pitt',
  'angelina-jolie',
  'tom-hanks',
  'anthony-hopkins',
]);

/** Classify a skill id into a persona category. */
function categorize(id: string): 'director' | 'actor' | 'other' {
  if (DIRECTOR_IDS.has(id)) return 'director';
  if (ACTOR_IDS.has(id)) return 'actor';
  return 'other';
}

/** Ensure the skills-2 repo is present locally, cloning or updating as needed. */
function ensureRepo(): string {
  const forceClone = process.env.SKILLS_FORCE_CLONE === '1';

  if (!existsSync(REPO_DIR)) {
    mkdirSync(CACHE_ROOT, { recursive: true });
    log(`cloning ${REPO_URL} -> ${REPO_DIR}`);
    execSync(`git clone --depth 1 ${REPO_URL} "${REPO_DIR}"`, { stdio: 'pipe' });
  } else if (forceClone) {
    log('SKILLS_FORCE_CLONE=1, refreshing repo');
    try {
      execSync(`git -C "${REPO_DIR}" pull --ff-only`, { stdio: 'pipe' });
    } catch (err) {
      log(`pull failed, leaving existing checkout: ${(err as Error).message}`);
    }
  }
  return REPO_DIR;
}

function log(msg: string): void {
  // stdout is the MCP protocol channel — always log to stderr.
  console.error(`[skills-movie-mcp] ${msg}`);
}

/** Pull the title from the first markdown H1, e.g. "# John Woo Skill" -> "John Woo". */
function extractTitle(raw: string, fallback: string): string {
  const m = raw.match(/^#\s+(.+)$/m);
  if (!m) return fallback;
  return m[1].replace(/\s+Skill\s*$/i, '').trim();
}

/** Pull the "You are ..." identity paragraph. */
function extractIdentity(raw: string): string {
  const m = raw.match(/You are ([^\n]+)/);
  return m ? m[1].trim() : '';
}

/** Pull the YAML frontmatter `description:` block if the file has one. */
function extractFrontmatterDescription(raw: string): string {
  const fm = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return '';
  const dm = fm[1].match(/description:\s*>?-?\s*([\s\S]*?)(?:\nname:|\ntriggers:|$)/);
  if (!dm) return '';
  return dm[1].replace(/\s+/g, ' ').trim();
}

function parseSkill(filePath: string, id: string): Skill {
  const raw = readFileSync(filePath, 'utf8');
  const category = categorize(id);
  return {
    id,
    title: extractTitle(raw, id),
    identity: extractIdentity(raw),
    raw,
    description: extractFrontmatterDescription(raw),
    path: filePath,
    category,
    isFilmmaker: category !== 'other',
  };
}

let cachedSkills: Map<string, Skill> | null = null;

/** Load and index every SKILL.md in the repo. Cached after first call. */
export function loadSkills(): Map<string, Skill> {
  if (cachedSkills) return cachedSkills;

  const repoDir = ensureRepo();
  const skills = new Map<string, Skill>();

  for (const entry of readdirSync(repoDir)) {
    if (entry.startsWith('.')) continue;
    const dir = join(repoDir, entry);
    if (!statSync(dir).isDirectory()) continue;
    const skillFile = join(dir, 'SKILL.md');
    if (!existsSync(skillFile)) continue;
    try {
      skills.set(entry, parseSkill(skillFile, entry));
    } catch (err) {
      log(`failed to parse ${skillFile}: ${(err as Error).message}`);
    }
  }

  cachedSkills = skills;
  const directors = [...skills.values()].filter((s) => s.category === 'director').length;
  const actors = [...skills.values()].filter((s) => s.category === 'actor').length;
  log(`loaded ${skills.size} skills (${directors} directors, ${actors} actors)`);
  return skills;
}

/** Get a single skill by id (folder name). Returns undefined if absent. */
export function getSkill(id: string): Skill | undefined {
  return loadSkills().get(id);
}

/**
 * Persona skills, optionally filtered to directors/actors only, sorted by title.
 * With no category filter, returns directors + actors (the film personas).
 */
export function listSkills(category?: 'director' | 'actor'): Skill[] {
  const all = [...loadSkills().values()];
  const filtered = category ? all.filter((s) => s.category === category) : all.filter((s) => s.isFilmmaker);
  return filtered.sort((a, b) => a.title.localeCompare(b.title));
}

/** Every skill in the repo, regardless of category, sorted by title. */
export function listAllSkills(): Skill[] {
  return [...loadSkills().values()].sort((a, b) => a.title.localeCompare(b.title));
}
