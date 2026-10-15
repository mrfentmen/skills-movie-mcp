# Skills Movie Studio (MCP Server)

An MCP server that exposes the filmmaker + actor personas from
[`mrfentmen/skills-2`](https://github.com/mrfentmen/skills-2) and a screenplay
toolkit, so an AI agent can **write long-form (~100 page) movie scripts in the
style of real directors and performers** — John Woo's gun-fu choreography,
Nolan's practical rigor, Tarantino's non-linear chapters, Kubrick's one-point
symmetry, Wong Kar-wai's mood, Daniel Day-Lewis's immersion, and more.

The server does **not** call an LLM itself. It provides the personas (as MCP
resources) and the assembly scaffold (as tools); the connected model does the
actual writing.

## What it provides

### Resources
- `skill://<id>` — the full `SKILL.md` for any persona. The `list` callback makes
  every film persona discoverable, so clients can browse them. e.g. `skill://nolan`.

### Tools
| Tool | Purpose |
|---|---|
| `list_directors` | List the director personas (id, title, one-line essence). |
| `list_actors` | List the actor/performance personas (method → discipline). |
| `list_skills` | List *every* persona skill in the catalog, with optional substring filter. |
| `blend_directors` | Stack several directors' techniques for one film. |
| `new_screenplay` | Start a script: title, logline, lead + blended directors, target pages (default 100). |
| `add_scene` | Append a scene (slug + prose); page count auto-estimated. |
| `screenplay_status` | Pages written vs target, percent complete, scene-by-scene outline. |
| `export_script` | Save the finished script as a standard `.fountain` file. |

**Directors shape the whole approach; actors shape how a single part is
inhabited.** As of now the catalog ships **16 directors** and **9 actors**.

## How a model writes a 100-page movie with it

1. `list_directors` / `list_actors` → pick a style (or `blend_directors` to fuse several).
2. Read `skill://<id>` to absorb the persona's principles.
3. `new_screenplay { title, logline, director, targetPages: 100 }`.
4. Loop: write a scene, `add_scene`, re-check `screenplay_status` until ~100 pages.
5. `export_script` → `./screenplays/<title>.fountain`.

## Requirements
- Node.js 20+
- Network access on first run (clones `skills-2` once into `./.cache`).

## Install & run

```sh
npm install
npm start          # runs over stdio
```

### Test it end-to-end
```sh
node test-client.mjs    # spawns the server, calls every tool, exports a demo
```

### Inspect it in the browser
```sh
npm run inspect        # opens the MCP Inspector
```

## Connect it to a client

### Claude Code
```sh
claude mcp add skills-movie -- npx tsx <path>/src/index.ts
```

### Claude Desktop / Cline / generic (mcp.json)
```json
{
  "mcpServers": {
    "skills-movie": {
      "command": "npx",
      "args": ["tsx", "<absolute path>/src/index.ts"],
      "env": {
        "SKILLS_CACHE_DIR": "<absolute path>/.cache"
      }
    }
  }
}
```

## Configuration (env vars)
| Var | Default | Meaning |
|---|---|---|
| `SKILLS_CACHE_DIR` | `./.cache` | Where the cloned repo is cached. |
| `SKILLS_REPO_DIR` | `<cache>/skills-2` | Point directly at an existing local clone of skills-2. |
| `SKILLS_FORCE_CLONE` | (unset) | Set `1` to `git pull` the repo on startup. |

## Project layout
```
src/skills.ts      # clone + parse every SKILL.md into an index (directors + actors)
src/screenplay.ts  # screenplay state, page estimation, Fountain export
src/index.ts       # the MCP server: resources + tools
test-client.mjs    # end-to-end smoke test
```
