import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';
export class ToolError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}
export class Tools {
  client = new Client({ name: 'medical-workflow', version: '1.0.0' });
  transport?: StdioClientTransport;
  connected = false;
  async connect() {
    const env: Record<string, string> = {};
    for (const k of [
      'PATH',
      'HOME',
      'TMPDIR',
      'MONGODB_URI',
      'STORAGE_ROOT',
      'MAX_PAGES',
      'MAX_UPLOAD_MB',
      'REVIEWER_NAME',
    ])
      if (process.env[k]) env[k] = process.env[k]!;
    this.transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve('dist/apps/mcp-server/main.js')],
      env,
      stderr: 'pipe',
    });
    this.transport.stderr?.on('data', () => {});
    await this.client.connect(this.transport, { timeout: 30000 });
    this.connected = true;
    this.client.onclose = () => {
      this.connected = false;
    };
    const tools = await this.client.listTools();
    if (!tools.tools.some((t) => t.name === 'get_system_health'))
      throw Error('MCP_CATALOG_INVALID');
  }
  async call<T = any>(name: string, payload: Record<string, unknown> = {}): Promise<T> {
    if (!this.connected) throw new ToolError('MCP_UNAVAILABLE', 503);
    const result = await this.client.callTool({ name, arguments: { payload } }, undefined, {
      timeout: 120000,
    });
    const text = (result.content as any[]).find((c) => c.type === 'text')?.text;
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ToolError('INVALID_TOOL_INPUT', 400);
    }
    if (!parsed.ok) throw new ToolError(parsed.code, parsed.status ?? 400);
    return parsed.data;
  }
  async reconnect() {
    await this.client.close().catch(() => {});
    this.client = new Client({ name: 'medical-workflow', version: '1.0.0' });
    await this.connect();
  }
  async close() {
    this.connected = false;
    await this.client.close();
  }
}
