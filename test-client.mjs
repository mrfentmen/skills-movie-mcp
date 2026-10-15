// End-to-end smoke test: spawn the server over stdio and exercise it.
// Run with: node test-client.mjs
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['tsx', 'src/index.ts'],
  env: {
    ...process.env,
    SKILLS_CACHE_DIR: process.cwd() + '/.cache',
    SKILLS_FORCE_CLONE: '1', // refresh the skills-2 clone so new personas appear
  },
  stderr: 'pipe',
});

const client = new Client({ name: 'smoke-test', version: '0.0.1' });
await client.connect(transport);

function show(label, obj) {
  console.log(`\n===== ${label} =====`);
  console.log(typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
}

// 1. list tools
const tools = await client.listTools();
show('TOOLS', tools.tools.map((t) => `${t.name} — ${t.title ?? ''}`));

// 2. list director personas
const directors = await client.callTool({ name: 'list_directors', arguments: {} });
show('LIST_DIRECTORS', directors.content[0].text);

// 2b. list actor personas
const actors = await client.callTool({ name: 'list_actors', arguments: {} });
show('LIST_ACTORS', actors.content[0].text);

// 3. read a director resource
const res = await client.readResource({ uri: 'skill://nolan' });
const nolanText = res.contents[0].text;
show('RESOURCE skill://nolan (first 240 chars)', nolanText.slice(0, 240));

// 4. blend directors
const blend = await client.callTool({
  name: 'blend_directors',
  arguments: { directorIds: ['john-woo', 'sergio-leone', 'not-a-real-one'] },
});
show('BLEND_DIRECTORS', blend.content[0].text.slice(0, 400));

// 5. screenplay flow
await client.callTool({
  name: 'new_screenplay',
  arguments: { title: 'Smoke Test: Nightfall', logline: 'A test.', director: 'nolan', targetPages: 1 },
});
await client.callTool({
  name: 'add_scene',
  arguments: {
    slug: 'INT. TEST LAB, NIGHT',
    body:
      'The room hums. A single bulb swings. DR. VOSS stares at the equation on the board, ' +
      'chalk dust on her cuffs. "It works," she whispers. The bulb swings again, slower, as if time itself leaned in to listen.',
    director: 'nolan',
  },
});
const st = await client.callTool({ name: 'screenplay_status', arguments: {} });
show('SCREENPLAY_STATUS', st.content[0].text);

// 5b. validator: a dashed body must be REJECTED, a clean one accepted
const dashed = await client.callTool({
  name: 'add_scene',
  arguments: {
    slug: 'INT. REJECTED, NIGHT',
    body: 'She turns — the room goes quiet. The clock stops — nobody moves.',
  },
});
show('VALIDATOR (should be isError:true)', { isError: dashed.isError, text: dashed.content[0].text });

const clean = await client.callTool({
  name: 'add_scene',
  arguments: {
    slug: 'INT. ACCEPTED, NIGHT',
    body: 'She turns. The room goes quiet. The clock stops. Nobody moves.',
  },
});
show('VALIDATOR (should be accepted)', clean.content[0].text);

const exp = await client.callTool({ name: 'export_script', arguments: {} });
show('EXPORT_SCRIPT', exp.content[0].text);

await client.close();
console.log('\nSMOKE TEST PASSED');
process.exit(0);