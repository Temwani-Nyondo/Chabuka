import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Demo agent (brief section 10): connects to Chabuka's MCP with a personal
// access token, lists the tools, and (with --run) performs a read-only task.
// Set AGENT_API_URL (default http://localhost:3001) and AGENT_TOKEN.

async function main() {
  const apiUrl = (process.env.AGENT_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
  const token = process.env.AGENT_TOKEN;
  if (!token) {
    console.error('AGENT_TOKEN is not set. Mint one on your Chabuka profile ("Connect an AI agent").');
    process.exit(1);
  }
  const transport = new StreamableHTTPClientTransport(new URL(`${apiUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'chabuka-agent-demo', version: '0.1.0' }, { capabilities: {} });
  await client.connect(transport);
  const { tools } = await client.listTools();
  console.log(`Connected to ${apiUrl}/mcp. Tools (${tools.length}):`);
  for (const tool of tools) console.log(` - ${tool.name}`);

  if (process.argv.includes('--run')) {
    const matches = await client.callTool({ name: 'search_matches', arguments: {} });
    console.log('search_matches ->', JSON.stringify(matches).slice(0, 600));
    const schedule = await client.callTool({ name: 'get_my_schedule', arguments: {} });
    console.log('get_my_schedule ->', JSON.stringify(schedule).slice(0, 600));
  }

  await client.close();
}

main().catch((err) => {
  console.error('DEMO_FAILED', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
