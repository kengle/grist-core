/**
 * MCP bridge in front of the Grist REST API.
 *
 * The caller's `Authorization` header is forwarded upstream verbatim. The token is
 * never validated, refreshed or stored here: Grist decides who it belongs to.
 */

import { FastMCP, type RequestVerifier } from '@prefecthq/fastmcp-ts/server';
import { createServer, request as httpRequest } from 'node:http';
import { z } from 'zod';

const GRIST_API_BASE = (process.env.GRIST_API_BASE ?? 'http://127.0.0.1:8484/api').replace(/\/+$/, '');
const MCP_RESOURCE_URL = (process.env.MCP_RESOURCE_URL ?? 'https://grist.localhost:8080').replace(/\/+$/, '');
const AUTH_SERVER = process.env.AUTH_SERVER ?? 'https://grist.localhost:8080/authelia';
const READ_ONLY = (process.env.READ_ONLY ?? '1') !== '0';
const PUBLIC_PORT = Number(process.env.BRIDGE_PORT ?? 8765);
const INTERNAL_PORT = Number(process.env.BRIDGE_INTERNAL_PORT ?? 8766);
const INTERNAL_HOST = '127.0.0.1';
const METADATA_PATH = '/.well-known/oauth-protected-resource';
const RESOURCE_METADATA = `${MCP_RESOURCE_URL}${METADATA_PATH}`;
const MAX_ERROR_BODY = 500;

/**
 * The bearer token of the call being handled. Taken from `ctx.auth`, which the
 * verifier below fills from the raw `Authorization` header; that header is withheld
 * from `ctx.request.headers` by the library.
 */
function currentToken(server: FastMCP): string {
    const token = server.getContext().auth?.token;
    if (!token) {
        throw new Error('Missing Authorization: Bearer <token>');
    }
    return token;
}

/** One Grist call; failures become text, never an uncaught exception. */
async function upstream(
    server: FastMCP,
    method: string,
    path: string,
    options: { params?: Record<string, string>; body?: unknown } = {},
): Promise<string> {
    const url = new URL(`${GRIST_API_BASE}${path}`);
    for (const [key, value] of Object.entries(options.params ?? {})) {
        url.searchParams.set(key, value);
    }
    const headers: Record<string, string> = {
        Authorization: `Bearer ${currentToken(server)}`,
        Accept: 'application/json',
    };
    const init: RequestInit = { method, headers };
    if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(options.body);
    }
    let response: Response;
    try {
        response = await fetch(url, init);
    } catch (error) {
        return `upstream request failed: ${(error as Error).message}`;
    }
    const text = await response.text();
    if (response.status >= 300) {
        return `Grist returned ${response.status}: ${text.slice(0, MAX_ERROR_BODY)}`;
    }
    return text;
}

const verifier: RequestVerifier = {
    async verifyRequest(request) {
        const header = request.headers.get('authorization');
        const match = header?.match(/^Bearer\s+(\S+)$/i);
        if (!match) {
            // Any error from verification becomes a 401.
            throw new Error('Missing Authorization: Bearer <token>');
        }
        return { token: match[1]!, scopes: [], claims: {} };
    },
};

const server = new FastMCP({
    name: 'grist',
    version: '0.1.0',
    auth: verifier,
    // Only reachable on the compose network, behind Caddy. The Host header arrives from
    // Caddy (the public name) or from a sibling container (its own name), so allow those.
    dnsRebinding: {
        allowedHosts: ['grist.localhost', 'grist-auth-grist-mcp-ts-1', '127.0.0.1', 'localhost'],
    },
});

server.tool(
    { name: 'list_orgs', description: "List the organizations the caller's token can see." },
    async () => upstream(server, 'GET', '/orgs'),
);

server.tool(
    {
        name: 'list_workspaces',
        inputSchema: {"type":"object","properties":{"org_id":{"type":"integer"}},"required":["org_id"],"additionalProperties":false},
        description: 'List workspaces (and their documents) in an organization.',
        input: z.object({ org_id: z.number().int() }),
    },
    async ({ org_id }) => upstream(server, 'GET', `/orgs/${org_id}/workspaces`),
);

server.tool(
    {
        name: 'list_docs',
        inputSchema: {"type":"object","properties":{"workspace_id":{"type":"integer"}},"required":["workspace_id"],"additionalProperties":false},
        description: 'List the documents of a workspace.',
        input: z.object({ workspace_id: z.number().int() }),
    },
    async ({ workspace_id }) => upstream(server, 'GET', `/workspaces/${workspace_id}`),
);

server.tool(
    {
        name: 'list_tables',
        inputSchema: {"type":"object","properties":{"doc_id":{"type":"string"}},"required":["doc_id"],"additionalProperties":false},
        description: 'List the tables of a document.',
        input: z.object({ doc_id: z.string() }),
    },
    async ({ doc_id }) => upstream(server, 'GET', `/docs/${doc_id}/tables`),
);

server.tool(
    {
        name: 'describe_table',
        inputSchema: {"type":"object","properties":{"doc_id":{"type":"string"},"table_id":{"type":"string"}},"required":["doc_id","table_id"],"additionalProperties":false},
        description: 'Describe the columns of a table.',
        input: z.object({ doc_id: z.string(), table_id: z.string() }),
    },
    async ({ doc_id, table_id }) => upstream(server, 'GET', `/docs/${doc_id}/tables/${table_id}/columns`),
);

server.tool(
    {
        name: 'query_records',
        inputSchema: {"type":"object","properties":{"doc_id":{"type":"string"},"table_id":{"type":"string"},"filter":{"type":["object","null"]},"sort":{"type":["string","null"]},"limit":{"type":["integer","null"]}},"required":["doc_id","table_id"],"additionalProperties":false},
        description:
            'Read records of a table. `filter` maps a column to a list of accepted values; ' +
            "`sort` is a comma separated list of columns, prefix a column with '-' for descending " +
            'order; `limit` caps the number of records.',
        input: z.object({
            doc_id: z.string(),
            table_id: z.string(),
            filter: z.record(z.array(z.union([z.string(), z.number(), z.boolean()]))).nullish(),
            sort: z.string().nullish(),
            limit: z.number().int().nullish(),
        }),
    },
    async ({ doc_id, table_id, filter, sort, limit }) => {
        const params: Record<string, string> = {};
        if (filter != null) {
            params.filter = JSON.stringify(filter);
        }
        if (sort != null) {
            params.sort = sort;
        }
        if (limit != null) {
            params.limit = String(limit);
        }
        return upstream(server, 'GET', `/docs/${doc_id}/tables/${table_id}/records`, { params });
    },
);

server.tool(
    {
        name: 'get_record',
        inputSchema: {"type":"object","properties":{"doc_id":{"type":"string"},"table_id":{"type":"string"},"record_id":{"type":"integer"}},"required":["doc_id","table_id","record_id"],"additionalProperties":false},
        description: 'Read a single record by its row id.',
        input: z.object({ doc_id: z.string(), table_id: z.string(), record_id: z.number().int() }),
    },
    async ({ doc_id, table_id, record_id }) =>
        upstream(server, 'GET', `/docs/${doc_id}/tables/${table_id}/records`, {
            params: { filter: JSON.stringify({ id: [record_id] }) },
        }),
);

if (!READ_ONLY) {
    server.tool(
        {
            name: 'add_records',
        inputSchema: {"type":"object","properties":{"doc_id":{"type":"string"},"table_id":{"type":"string"},"records":{"type":"array","items":{"type":"object"}}},"required":["doc_id","table_id","records"],"additionalProperties":false},
            description: 'Add records. Each record is an object of column id to value.',
            input: z.object({
                doc_id: z.string(),
                table_id: z.string(),
                records: z.array(z.record(z.unknown())),
            }),
        },
        async ({ doc_id, table_id, records }) =>
            upstream(server, 'POST', `/docs/${doc_id}/tables/${table_id}/records`, {
                body: { records: records.map((fields) => ({ fields })) },
            }),
    );

    server.tool(
        {
            name: 'update_records',
        inputSchema: {"type":"object","properties":{"doc_id":{"type":"string"},"table_id":{"type":"string"},"records":{"type":"array","items":{"type":"object"}}},"required":["doc_id","table_id","records"],"additionalProperties":false},
            description: 'Update records. Each record must include `id` plus the fields to change.',
            input: z.object({
                doc_id: z.string(),
                table_id: z.string(),
                records: z.array(z.record(z.unknown())),
            }),
        },
        async ({ doc_id, table_id, records }) =>
            upstream(server, 'PATCH', `/docs/${doc_id}/tables/${table_id}/records`, {
                body: {
                    records: records.map(({ id, ...fields }) => ({ id, fields })),
                },
            }),
    );

    server.tool(
        {
            name: 'delete_records',
        inputSchema: {"type":"object","properties":{"doc_id":{"type":"string"},"table_id":{"type":"string"},"ids":{"type":"array","items":{"type":"integer"}}},"required":["doc_id","table_id","ids"],"additionalProperties":false},
            description: 'Delete records by row id.',
            input: z.object({
                doc_id: z.string(),
                table_id: z.string(),
                ids: z.array(z.number().int()),
            }),
        },
        async ({ doc_id, table_id, ids }) =>
            upstream(server, 'POST', `/docs/${doc_id}/tables/${table_id}/records/delete`, { body: ids }),
    );
}

/**
 * The public listener. It owns the two pieces of behaviour the library does not
 * expose: the RFC 9728 metadata document, and a 401 for a request without a bearer
 * token. Everything under `/mcp` is proxied untouched to the library's listener.
 */
const front = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';

    if (path === METADATA_PATH) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ resource: MCP_RESOURCE_URL, authorization_servers: [AUTH_SERVER] }));
        return;
    }

    if (!req.headers.authorization) {
        res.writeHead(401, {
            'WWW-Authenticate': `Bearer resource_metadata="${RESOURCE_METADATA}"`,
            'Content-Type': 'text/plain',
        });
        res.end('Missing Authorization: Bearer <token>');
        return;
    }

    if (!path.startsWith('/mcp')) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
    }

    const proxy = httpRequest(
        {
            host: INTERNAL_HOST,
            port: INTERNAL_PORT,
            method: req.method,
            path: req.url,
            headers: req.headers,
        },
        (upstreamResponse) => {
            res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
            upstreamResponse.pipe(res);
        },
    );
    proxy.on('error', () => {
        if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
        }
        res.end('Bad gateway');
    });
    req.pipe(proxy);
});

await server.run({ transport: 'http', host: INTERNAL_HOST, port: INTERNAL_PORT });
front.listen(PUBLIC_PORT, '0.0.0.0');
