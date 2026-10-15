import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { getSkill, listAllSkills, listSkills } from './skills.ts';
import {
  addScene,
  exportScript,
  getCurrent,
  newScreenplay,
  status,
} from './screenplay.ts';

/**
 * Enforce the absolute no-dashes rule at the server boundary. Returns a human
 * message describing the first forbidden dash found in `text`, or null if clean.
 * Allowed: hyphens inside a compound word (hard-boiled) and the INT./EXT. scene
 * separator. Forbidden: em dash, en dash, and a hyphen used as a separator.
 */
function findDashViolation(text: string): string | null {
  if (text.includes('—')) return 'an em dash';
  if (text.includes('–')) return 'an en dash';
  if (/(?<=\S) - (?=\S)/.test(text)) return 'a hyphen used as a separator';
  return null;
}

function createServer(): McpServer {
  const server = new McpServer(
    {
      name: 'skills-movie-mcp',
      title: 'Skills Movie Studio',
      version: '1.0.0',
    },
    {
      instructions:
        'This server exposes the mrfentmen/skills-2 filmmaker + actor personas and a ' +
        'screenplay toolkit for writing long-form (up to ~100 page) movie scripts. ' +
        'Workflow: (1) call list_directors or list_actors to pick a style, (2) read the ' +
        'persona resource skill://<id> to absorb it, (3) call new_screenplay to start, ' +
        '(4) write the script scene-by-scene with add_scene, checking screenplay_status as ' +
        'you go, and (5) call export_script to save the Fountain file. Directors shape the ' +
        'whole approach; actors shape how a single part is inhabited. The host model does ' +
        'all the actual writing — these tools provide the personas and the assembly scaffold.',
    },
  );

  // ---------------------------------------------------------------------------
  // RESOURCES — one per skill, addressable as skill://<id>
  // ---------------------------------------------------------------------------

  // A resource template so any skill://<name> URI resolves on demand.
  server.registerResource(
    'skill',
    new ResourceTemplate('skill://{id}', {
      list: async () => ({
        resources: listSkills().map((s) => ({
          uri: `skill://${s.id}`,
          name: s.title,
          description: `${s.category}: ${s.identity.slice(0, 160)}`,
          mimeType: 'text/markdown',
        })),
      }),
    }),
    { mimeType: 'text/markdown', title: 'A skills-2 persona' },
    async (uri, { id }) => {
      const skill = getSkill(String(id));
      if (!skill) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'text/plain',
              text: `No skill named "${id}". Call list_directors or list_skills to see valid ids.`,
            },
          ],
        };
      }
      return {
        contents: [{ uri: uri.href, mimeType: 'text/markdown', text: skill.raw }],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // TOOLS
  // ---------------------------------------------------------------------------

  // list_directors — the filmmaker personas, the ones you actually want for movies.
  server.registerTool(
    'list_directors',
    {
      title: 'List director personas',
      description:
        'List the available filmmaker/director personas (john-woo, wong-kar-wai, tarantino, ' +
        'kubrick, nolan, james-cameron, walt-disney, hitchcock, fincher, kurosawa, spielberg, ' +
        'and more). Returns id, title, and the one-line essence of each. Read skill://<id> ' +
        'for the full persona before writing.',
      inputSchema: z.object({}),
    },
    async () => {
      const directors = listSkills('director');
      const lines = directors.map(
        (s) => `- ${s.id} — ${s.title}: ${s.identity.slice(0, 150)}`,
      );
      return {
        content: [
          {
            type: 'text',
            text:
              `Available director personas (${directors.length}):\n\n` +
              (lines.join('\n') || '(none found — is the skills-2 repo reachable?)\n\nRead any with skill://<id>.') +
              `\n\nTip: call list_actors for performer personas, or blend_directors to fuse several.`,
          },
        ],
      };
    },
  );

  // list_actors — the performer personas (method/inhabitation disciplines).
  server.registerTool(
    'list_actors',
    {
      title: 'List actor personas',
      description:
        'List the available actor/performance personas (jackie-chan, daniel-day-lewis, ' +
        'meryl-streep, denzel-washington, al-pacino, brad-pitt, angelina-jolie, tom-hanks, ' +
        'anthony-hopkins). Each is a performance discipline mapped to engineering. ' +
        'Read skill://<id> for the full persona.',
      inputSchema: z.object({}),
    },
    async () => {
      const actors = listSkills('actor');
      const lines = actors.map(
        (s) => `- ${s.id} — ${s.title}: ${s.identity.slice(0, 150)}`,
      );
      return {
        content: [
          {
            type: 'text',
            text:
              `Available actor personas (${actors.length}):\n\n` +
              (lines.join('\n') || '(none found — is the skills-2 repo reachable?)\n\nRead any with skill://<id>.'),
          },
        ],
      };
    },
  );

  // list_skills — every persona in the repo, not just directors.
  server.registerTool(
    'list_skills',
    {
      title: 'List all persona skills',
      description:
        'List every persona skill in the skills-2 catalog (all ~180, not only directors). ' +
        'Useful when you want a non-film discipline to shape part of the work.',
      inputSchema: z.object({
        filter: z.string().optional().describe('Case-insensitive substring to filter names/titles by.'),
      }),
    },
    async ({ filter }) => {
      let skills = listAllSkills();
      if (filter) {
        const f = filter.toLowerCase();
        skills = skills.filter(
          (s) => s.id.includes(f) || s.title.toLowerCase().includes(f) || s.identity.toLowerCase().includes(f),
        );
      }
      const lines = skills.map((s) => `- ${s.id}${s.isFilmmaker ? ` (${s.category})` : ''} — ${s.title}`);
      return {
        content: [
          { type: 'text', text: `Matched ${skills.length} skill(s):\n\n${lines.join('\n') || '(no matches)'}` },
        ],
      };
    },
  );

  // blend_directors — combine multiple directors' techniques for one film.
  server.registerTool(
    'blend_directors',
    {
      title: 'Blend director personas',
      description:
        'Given several director ids, return each persona\'s core principles stacked together, ' +
        'so the model can write a single film that fuses their techniques (e.g. the parallelism ' +
        'of john-woo with the pacing of sergio-leone). Validates the ids and reports any misses.',
      inputSchema: z.object({
        directorIds: z
          .array(z.string())
          .min(1)
          .describe('Director ids to blend, e.g. ["john-woo","nolan"].'),
      }),
    },
    async ({ directorIds }) => {
      const found: string[] = [];
      const missing: string[] = [];
      for (const id of directorIds) {
        if (getSkill(id)) found.push(id);
        else missing.push(id);
      }
      const sections = found.map((id) => {
        const s = getSkill(id)!;
        return `### ${s.title} (skill://${id})\n${s.identity}`;
      });
      const parts: string[] = [];
      if (sections.length) {
        parts.push(
          `Blend of ${found.length} director(s). Write the film so every scene honors ALL of these at once — where they conflict, pick the tension deliberately:\n\n` +
            sections.join('\n\n'),
        );
      }
      if (missing.length) {
        parts.push(`\nNot found (check list_directors): ${missing.join(', ')}`);
      }
      return { content: [{ type: 'text', text: parts.join('\n') || 'No valid directors given.' }] };
    },
  );

  // new_screenplay — start (or restart) the script.
  server.registerTool(
    'new_screenplay',
    {
      title: 'Start a new screenplay',
      description:
        'Begin a new screenplay. Sets the title, logline, the lead director persona, any ' +
        'blended directors, and the target page count (default 100). Resets any script in progress.',
      inputSchema: z.object({
        title: z.string().describe('The film title.'),
        logline: z.string().optional().describe('One-sentence premise.'),
        director: z.string().optional().describe('Lead director persona id, e.g. "nolan".'),
        blendedDirectors: z.array(z.string()).optional().describe('Additional director ids to fuse in.'),
        targetPages: z.number().int().positive().optional().describe('Target page count; default 100.'),
      }),
    },
    async (args) => {
      const sp = newScreenplay({
        title: args.title,
        logline: args.logline,
        director: args.director,
        blendedDirectors: args.blendedDirectors,
        targetPages: args.targetPages,
      });
      return {
        content: [
          {
            type: 'text',
            text:
              `Started screenplay "${sp.title}" targeting ${sp.targetPages} pages.` +
              (sp.director ? ` Lead director: ${sp.director}.` : '') +
              (sp.blendedDirectors.length ? ` Blended: ${sp.blendedDirectors.join(', ')}.` : '') +
              `\nNow write it scene by scene with add_scene; check progress with screenplay_status.`,
          },
        ],
      };
    },
  );

  // add_scene — append one scene/sequence.
  server.registerTool(
    'add_scene',
    {
      title: 'Add a scene',
      description:
        'Append one scene to the screenplay. Provide a Fountain-style slug line (e.g. ' +
        '"INT. WAREHOUSE, NIGHT"), the prose/action/dialogue you wrote, and optionally the ' +
        'director persona guiding the scene. Page count is estimated from length unless you set it. ' +
        'Enforces the absolute no-dashes rule: the body is rejected if it contains an em dash, ' +
        'en dash, or a separator hyphen (compound-word hyphens are fine).',
      inputSchema: z.object({
        slug: z.string().describe('Scene heading, e.g. "EXT. CITY STREET, DAWN".'),
        body: z.string().describe('The scene prose: action and dialogue. No dashes.'),
        director: z.string().optional().describe('Director persona id guiding this scene.'),
        pages: z.number().optional().describe('Override the estimated page length.'),
      }),
    },
    async (args) => {
      const violation = findDashViolation(args.body);
      if (violation) {
        return {
          content: [
            {
              type: 'text',
              text:
                `Rejected: the scene body contains ${violation}. The no-dashes rule is absolute: ` +
                `rewrite using a comma, period, semicolon, colon, or parentheses. Compound-word ` +
                `hyphens (hard-boiled) are fine; em dashes, en dashes, and separator hyphens are not.`,
            },
          ],
          isError: true,
        };
      }
      const scene = addScene({
        slug: args.slug,
        body: args.body,
        director: args.director,
        pages: args.pages,
      });
      const st = status();
      return {
        content: [
          {
            type: 'text',
            text:
              `Added scene ${scene.number}: "${scene.slug}" (~${scene.pages} pg). ` +
              `Total: ${st.pagesSoFar}/${st.targetPages} pages (${st.percentComplete}%), ${st.sceneCount} scenes.` +
              (st.remainingPages > 0 ? ` ~${st.remainingPages} pages to go.` : ' Target reached!'),
          },
        ],
      };
    },
  );

  // screenplay_status — where are we.
  server.registerTool(
    'screenplay_status',
    {
      title: 'Screenplay status',
      description:
        'Report the current screenplay: title, director(s), scene count, pages written vs target, ' +
        'percent complete, and a scene-by-scene outline. Call this periodically while writing.',
      inputSchema: z.object({}),
    },
    async () => {
      const st = status();
      const outline = st.scenes.map((s) => `${s.number}. ${s.slug} (~${s.pages} pg)`).join('\n');
      const text =
        `"${st.title}" — ${st.sceneCount} scenes, ${st.pagesSoFar}/${st.targetPages} pages (${st.percentComplete}%).` +
        (st.director ? ` Director: ${st.director}.` : '') +
        (st.blendedDirectors.length ? ` Blended: ${st.blendedDirectors.join(', ')}.` : '') +
        (outline ? `\n\nOutline:\n${outline}` : '\n\n(no scenes yet)');
      return { content: [{ type: 'text', text }] };
    },
  );

  // export_script — save the Fountain file.
  server.registerTool(
    'export_script',
    {
      title: 'Export screenplay',
      description:
        'Export the current screenplay to a .fountain file (standard screenplay plain-text) ' +
        'under ./screenplays/. Returns the absolute path written.',
      inputSchema: z.object({
        outputDir: z.string().optional().describe('Directory to write into; defaults to ./screenplays.'),
      }),
    },
    async ({ outputDir }) => {
      try {
        const path = exportScript(outputDir);
        const sp = getCurrent()!;
        return {
          content: [
            {
              type: 'text',
              text: `Exported "${sp.title}" (${status().pagesSoFar} pages, ${status().sceneCount} scenes) to ${path}`,
            },
          ],
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Export failed: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  return server;
}

void serveStdio(createServer);
console.error('[skills-movie-mcp] server running on stdio');
