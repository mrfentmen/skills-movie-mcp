import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** One screenplay scene / sequence. */
export interface Scene {
  /** 1-based order in the script */
  number: number;
  /** slug heading, e.g. "INT. ABANDONED WAREHOUSE, NIGHT" */
  slug: string;
  /** the director persona id used to "shoot" this scene, if any */
  director?: string;
  /** the prose/action/dialogue the AI wrote for this scene */
  body: string;
  /** rough page length estimate (industry rule: ~1 page = 1 minute) */
  pages: number;
}

/** The screenplay currently being assembled. */
export interface Screenplay {
  title: string;
  logline: string;
  /** the director persona id driving the whole film */
  director?: string;
  /** blended persona ids contributing techniques */
  blendedDirectors: string[];
  /** target page count (default 100) */
  targetPages: number;
  scenes: Scene[];
  createdAt: string;
}

/**
 * In-memory screenplay state. A single server process serves one screenplay at a
 * time; `new_screenplay` resets it. This keeps the toolkit stateless across MCP
 * reconnects from the model's point of view while staying simple.
 */
let current: Screenplay | null = null;

/** Rough page estimate from word count. ~190 words ≈ 1 screenplay page. */
function estimatePages(body: string): number {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(0.1, Math.round((words / 190) * 10) / 10);
}

export function newScreenplay(opts: {
  title: string;
  logline?: string;
  director?: string;
  blendedDirectors?: string[];
  targetPages?: number;
}): Screenplay {
  current = {
    title: opts.title,
    logline: opts.logline ?? '',
    director: opts.director,
    blendedDirectors: opts.blendedDirectors ?? [],
    targetPages: opts.targetPages ?? 100,
    scenes: [],
    createdAt: new Date().toISOString(),
  };
  return current;
}

export function addScene(input: {
  slug: string;
  body: string;
  director?: string;
  pages?: number;
}): Scene {
  if (!current) {
    // Auto-create a bare screenplay so the model never loses work.
    current = newScreenplay({ title: 'Untitled Screenplay' });
  }
  const scene: Scene = {
    number: current.scenes.length + 1,
    slug: input.slug,
    director: input.director ?? current.director,
    body: input.body,
    pages: input.pages ?? estimatePages(input.body),
  };
  current.scenes.push(scene);
  return scene;
}

export interface ScreenplayStatus {
  title: string;
  director?: string;
  blendedDirectors: string[];
  sceneCount: number;
  pagesSoFar: number;
  targetPages: number;
  percentComplete: number;
  remainingPages: number;
  scenes: { number: number; slug: string; pages: number; director?: string }[];
}

export function status(): ScreenplayStatus {
  if (!current) {
    return {
      title: '(none)',
      blendedDirectors: [],
      sceneCount: 0,
      pagesSoFar: 0,
      targetPages: 100,
      percentComplete: 0,
      remainingPages: 100,
      scenes: [],
    };
  }
  const pagesSoFar =
    Math.round(current.scenes.reduce((sum, s) => sum + s.pages, 0) * 10) / 10;
  const percentComplete = Math.min(100, Math.round((pagesSoFar / current.targetPages) * 100));
  return {
    title: current.title,
    director: current.director,
    blendedDirectors: current.blendedDirectors,
    sceneCount: current.scenes.length,
    pagesSoFar,
    targetPages: current.targetPages,
    percentComplete,
    remainingPages: Math.max(0, Math.round((current.targetPages - pagesSoFar) * 10) / 10),
    scenes: current.scenes.map((s) => ({
      number: s.number,
      slug: s.slug,
      pages: s.pages,
      director: s.director,
    })),
  };
}

/** Render the screenplay as Fountain markup (the standard screenplay plain-text format). */
export function toFountain(sp: Screenplay = current!): string {
  const lines: string[] = [];
  lines.push(`Title: ${sp.title}`);
  if (sp.logline) lines.push(`Credit: ${sp.logline}`);
  lines.push('');
  for (const scene of sp.scenes) {
    lines.push(scene.slug);
    lines.push('');
    lines.push(scene.body.trim());
    lines.push('');
  }
  return lines.join('\n');
}

/** Export the current screenplay to a file. Returns the absolute path written. */
export function exportScript(outputDir = join(process.cwd(), 'screenplays')): string {
  if (!current) throw new Error('No screenplay in progress. Call new_screenplay first.');
  mkdirSync(outputDir, { recursive: true });
  const safeTitle = current.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'screenplay';
  const filePath = join(outputDir, `${safeTitle}.fountain`);
  writeFileSync(filePath, toFountain(current), 'utf8');
  return filePath;
}

export function getCurrent(): Screenplay | null {
  return current;
}
