/**
 * MCP bridge in front of the Grist REST API.
 *
 * The caller's `Authorization` header is forwarded upstream verbatim. The token is never
 * validated, refreshed or stored here: Grist decides who it belongs to, and what that user
 * may do. Every tool maps onto one Grist REST endpoint.
 */

import { FastMCP, type RequestVerifier } from '@prefecthq/fastmcp-ts/server';
import { createServer, request as httpRequest } from 'node:http';
import { z } from 'zod';

const GRIST_API_BASE = (process.env.GRIST_API_BASE ?? 'http://127.0.0.1:8484/api').replace(/\/+$/, '');
const MCP_RESOURCE_URL = (process.env.MCP_RESOURCE_URL ?? 'https://grist.localhost:8080').replace(/\/+$/, '');
const AUTH_SERVER = process.env.AUTH_SERVER ?? 'https://grist.localhost:8080/authelia';
const PUBLIC_PORT = Number(process.env.BRIDGE_PORT ?? 8765);
const INTERNAL_PORT = Number(process.env.BRIDGE_INTERNAL_PORT ?? 8766);
const INTERNAL_HOST = '127.0.0.1';
const METADATA_PATH = '/.well-known/oauth-protected-resource';
const RESOURCE_METADATA = `${MCP_RESOURCE_URL}${METADATA_PATH}`;
const MAX_ERROR_BODY = 500;
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

/** The bearer token of the call being handled, filled by the verifier below. */
function currentToken(server: FastMCP): string {
    const token = server.getContext().auth?.token;
    if (!token) {
        throw new Error('Missing Authorization: Bearer <token>');
    }
    return token;
}

interface CallOptions {
    params?: Record<string, string>;
    body?: unknown;
    form?: FormData;
}

/** One Grist call; failures become text, never an uncaught exception. */
async function upstream(
    server: FastMCP,
    method: string,
    path: string,
    options: CallOptions = {},
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
    if (options.form !== undefined) {
        init.body = options.form;          // fetch sets the multipart boundary itself
    } else if (options.body !== undefined) {
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
        const match = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i);
        if (!match) {
            throw new Error('Missing Authorization: Bearer <token>');
        }
        return { token: match[1]!, scopes: [], claims: {} };
    },
};

const server = new FastMCP({
    name: 'grist',
    version: '0.2.0',
    auth: verifier,
    // Only reachable from inside the container and through Caddy; allow their Host headers.
    dnsRebinding: {
        allowedHosts: ['grist.localhost', '127.0.0.1', 'localhost'],
    },
});

/** JSON Schema advertised to clients; zod's own generation is not picked up by the library. */
const SCHEMA = {
    org: { type: 'object', properties: { org_id: { type: 'integer' } }, required: ['org_id'], additionalProperties: false },
    workspace: { type: 'object', properties: { workspace_id: { type: 'integer' } }, required: ['workspace_id'], additionalProperties: false },
    doc: { type: 'object', properties: { doc_id: { type: 'string' } }, required: ['doc_id'], additionalProperties: false },
    table: {
        type: 'object',
        properties: { doc_id: { type: 'string' }, table_id: { type: 'string' } },
        required: ['doc_id', 'table_id'],
        additionalProperties: false,
    },
} as const;

const DOC = 'Access is decided by the user of the calling token, not by this bridge.';

server.tool(
    { name: 'list_orgs', description: `List the organizations the calling token can see. ${DOC}` },
    async () => upstream(server, 'GET', '/orgs'),
);

server.tool(
    {
        name: 'list_workspaces',
        description: `List workspaces, with their documents, in an organization. ${DOC}`,
        input: z.object({ org_id: z.number().int() }),
        inputSchema: SCHEMA.org,
    },
    async ({ org_id }) => upstream(server, 'GET', `/orgs/${org_id}/workspaces`),
);

server.tool(
    {
        name: 'list_docs',
        description: `List the documents of a workspace. ${DOC}`,
        input: z.object({ workspace_id: z.number().int() }),
        inputSchema: SCHEMA.workspace,
    },
    async ({ workspace_id }) => upstream(server, 'GET', `/workspaces/${workspace_id}`),
);

server.tool(
    {
        name: 'get_doc',
        description: `Metadata of one document: name, workspace, org, access. ${DOC}`,
        input: z.object({ doc_id: z.string() }),
        inputSchema: SCHEMA.doc,
    },
    async ({ doc_id }) => upstream(server, 'GET', `/docs/${doc_id}`),
);

server.tool(
    {
        name: 'list_tables',
        description: `List the tables of a document, including summary tables. ${DOC}`,
        input: z.object({ doc_id: z.string() }),
        inputSchema: SCHEMA.doc,
    },
    async ({ doc_id }) => upstream(server, 'GET', `/docs/${doc_id}/tables`),
);

server.tool(
    {
        name: 'describe_table',
        description: `List the columns of a table, with their types and formulas. ${DOC}`,
        input: z.object({ doc_id: z.string(), table_id: z.string() }),
        inputSchema: SCHEMA.table,
    },
    async ({ doc_id, table_id }) => upstream(server, 'GET', `/docs/${doc_id}/tables/${table_id}/columns`),
);

server.tool(
    {
        name: 'query_records',
        description:
            'Read records of a table. `filter` maps a column to the list of accepted values; `sort` is a ' +
            "comma separated list of column ids, a leading '-' sorts descending; `limit` caps the count.",
        input: z.object({
            doc_id: z.string(),
            table_id: z.string(),
            filter: z.record(z.array(z.union([z.string(), z.number(), z.boolean()]))).nullish(),
            sort: z.string().nullish(),
            limit: z.number().int().nullish(),
        }),
        inputSchema: {
            type: 'object',
            properties: {
                doc_id: { type: 'string' },
                table_id: { type: 'string' },
                filter: { type: ['object', 'null'] },
                sort: { type: ['string', 'null'] },
                limit: { type: ['integer', 'null'] },
            },
            required: ['doc_id', 'table_id'],
            additionalProperties: false,
        },
    },
    async ({ doc_id, table_id, filter, sort, limit }) => {
        const params: Record<string, string> = {};
        if (filter != null) { params.filter = JSON.stringify(filter); }
        if (sort != null) { params.sort = sort; }
        if (limit != null) { params.limit = String(limit); }
        return upstream(server, 'GET', `/docs/${doc_id}/tables/${table_id}/records`, { params });
    },
);

server.tool(
    {
        name: 'get_record',
        description: `Read one record by row id. ${DOC}`,
        input: z.object({ doc_id: z.string(), table_id: z.string(), record_id: z.number().int() }),
        inputSchema: {
            type: 'object',
            properties: { doc_id: { type: 'string' }, table_id: { type: 'string' }, record_id: { type: 'integer' } },
            required: ['doc_id', 'table_id', 'record_id'],
            additionalProperties: false,
        },
    },
    async ({ doc_id, table_id, record_id }) =>
        upstream(server, 'GET', `/docs/${doc_id}/tables/${table_id}/records`, {
            params: { filter: JSON.stringify({ id: [record_id] }) },
        }),
);

const RECORDS_SCHEMA = {
    type: 'object',
    properties: {
        doc_id: { type: 'string' },
        table_id: { type: 'string' },
        records: { type: 'array', items: { type: 'object' } },
    },
    required: ['doc_id', 'table_id', 'records'],
    additionalProperties: false,
} as const;

server.tool(
    {
        name: 'add_records',
        description: `Add rows; each item maps column id to value. ${DOC}`,
        input: z.object({ doc_id: z.string(), table_id: z.string(), records: z.array(z.record(z.unknown())) }),
        inputSchema: RECORDS_SCHEMA,
    },
    async ({ doc_id, table_id, records }) =>
        upstream(server, 'POST', `/docs/${doc_id}/tables/${table_id}/records`, {
            body: { records: records.map((fields) => ({ fields })) },
        }),
);

server.tool(
    {
        name: 'update_records',
        description: `Update rows; each item holds \`id\` plus the columns to change. ${DOC}`,
        input: z.object({ doc_id: z.string(), table_id: z.string(), records: z.array(z.record(z.unknown())) }),
        inputSchema: RECORDS_SCHEMA,
    },
    async ({ doc_id, table_id, records }) =>
        upstream(server, 'PATCH', `/docs/${doc_id}/tables/${table_id}/records`, {
            body: { records: records.map(({ id, ...fields }) => ({ id, fields })) },
        }),
);

server.tool(
    {
        name: 'delete_records',
        description: `Delete rows by row id. ${DOC}`,
        input: z.object({ doc_id: z.string(), table_id: z.string(), record_ids: z.array(z.number().int()) }),
        inputSchema: {
            type: 'object',
            properties: {
                doc_id: { type: 'string' },
                table_id: { type: 'string' },
                record_ids: { type: 'array', items: { type: 'integer' } },
            },
            required: ['doc_id', 'table_id', 'record_ids'],
            additionalProperties: false,
        },
    },
    async ({ doc_id, table_id, record_ids }) =>
        upstream(server, 'POST', `/docs/${doc_id}/tables/${table_id}/records/delete`, {
            body: record_ids.map((id) => Number(id)),
        }),
);

server.tool(
    {
        name: 'apply_user_actions',
        description:
            'Apply Grist user actions such as AddTable, AddColumn, ModifyColumn, UpdateRecord, AddRecord, ' +
            'RemoveRecord, CreateViewSection or SetACLRule. This is the general entry point: creating tables, ' +
            'changing formulas and editing access rules all go through it. `actions` is passed to Grist as is. ' +
            DOC,
        input: z.object({ doc_id: z.string(), actions: z.array(z.array(z.unknown())) }),
        inputSchema: {
            type: 'object',
            properties: {
                doc_id: { type: 'string' },
                actions: { type: 'array', items: { type: 'array' } },
            },
            required: ['doc_id', 'actions'],
            additionalProperties: false,
        },
    },
    async ({ doc_id, actions }) => upstream(server, 'POST', `/docs/${doc_id}/apply`, { body: actions }),
);

server.tool(
    {
        name: 'create_doc',
        description: `Create an empty document in a workspace; returns its id. ${DOC}`,
        input: z.object({ workspace_id: z.number().int(), name: z.string() }),
        inputSchema: {
            type: 'object',
            properties: { workspace_id: { type: 'integer' }, name: { type: 'string' } },
            required: ['workspace_id', 'name'],
            additionalProperties: false,
        },
    },
    async ({ workspace_id, name }) =>
        upstream(server, 'POST', '/docs', { body: { workspaceId: workspace_id, documentName: name } }),
);

server.tool(
    {
        name: 'copy_doc',
        description: `Copy a document into a workspace; returns the new id. ${DOC}`,
        input: z.object({ doc_id: z.string(), workspace_id: z.number().int(), name: z.string().nullish() }),
        inputSchema: {
            type: 'object',
            properties: {
                doc_id: { type: 'string' },
                workspace_id: { type: 'integer' },
                name: { type: ['string', 'null'] },
            },
            required: ['doc_id', 'workspace_id'],
            additionalProperties: false,
        },
    },
    async ({ doc_id, workspace_id, name }) =>
        upstream(server, 'POST', `/docs/${doc_id}/copy`, {
            body: { workspaceId: workspace_id, ...(name == null ? {} : { documentName: name }) },
        }),
);

server.tool(
    {
        name: 'remove_doc',
        description: `Move a document to the trash (recoverable); it is not deleted for good. ${DOC}`,
        input: z.object({ doc_id: z.string() }),
        inputSchema: SCHEMA.doc,
    },
    async ({ doc_id }) => upstream(server, 'POST', `/docs/${doc_id}/remove`),
);

server.tool(
    {
        name: 'upload_attachment',
        description:
            'Upload a file to a document and return its attachment id. `content_base64` is the base64 of the ' +
            `file, at most 50 MB. ${DOC}`,
        input: z.object({ doc_id: z.string(), filename: z.string(), content_base64: z.string() }),
        inputSchema: {
            type: 'object',
            properties: {
                doc_id: { type: 'string' },
                filename: { type: 'string' },
                content_base64: { type: 'string' },
            },
            required: ['doc_id', 'filename', 'content_base64'],
            additionalProperties: false,
        },
    },
    async ({ doc_id, filename, content_base64 }) => {
        const bytes = Buffer.from(content_base64, 'base64');
        if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
            return `attachment too large: ${bytes.byteLength} bytes, limit ${MAX_ATTACHMENT_BYTES}`;
        }
        const form = new FormData();
        form.append('upload', new Blob([new Uint8Array(bytes)]), filename);
        return upstream(server, 'POST', `/docs/${doc_id}/attachments`, { form });
    },
);

server.tool(
    {
        name: 'list_webhooks',
        description: `List the webhooks of a document. ${DOC}`,
        input: z.object({ doc_id: z.string() }),
        inputSchema: SCHEMA.doc,
    },
    async ({ doc_id }) => upstream(server, 'GET', `/docs/${doc_id}/webhooks`),
);

server.tool(
    {
        name: 'create_webhook',
        description: `Create a webhook on a document. \`event_types\` are Grist event names; \`url\` is the target. ${DOC}`,
        input: z.object({
            doc_id: z.string(),
            url: z.string(),
            event_types: z.array(z.string()),
            enabled: z.boolean().nullish(),
            name: z.string().nullish(),
            memo: z.string().nullish(),
        }),
        inputSchema: {
            type: 'object',
            properties: {
                doc_id: { type: 'string' },
                url: { type: 'string' },
                event_types: { type: 'array', items: { type: 'string' } },
                enabled: { type: ['boolean', 'null'] },
                name: { type: ['string', 'null'] },
                memo: { type: ['string', 'null'] },
            },
            required: ['doc_id', 'url', 'event_types'],
            additionalProperties: false,
        },
    },
    async ({ doc_id, url, event_types, enabled, name, memo }) =>
        upstream(server, 'POST', `/docs/${doc_id}/webhooks`, {
            body: {
                webhooks: [{
                    fields: {
                        url,
                        eventTypes: event_types,
                        ...(enabled == null ? {} : { enabled }),
                        ...(name == null ? {} : { name }),
                        ...(memo == null ? {} : { memo }),
                    },
                }],
            },
        }),
);

server.tool(
    {
        name: 'delete_webhook',
        description: `Delete one webhook of a document. ${DOC}`,
        input: z.object({ doc_id: z.string(), webhook_id: z.number().int() }),
        inputSchema: {
            type: 'object',
            properties: { doc_id: { type: 'string' }, webhook_id: { type: 'integer' } },
            required: ['doc_id', 'webhook_id'],
            additionalProperties: false,
        },
    },
    async ({ doc_id, webhook_id }) => upstream(server, 'DELETE', `/docs/${doc_id}/webhooks/${webhook_id}`),
);

/**
 * The public listener: the metadata document, a 401 without a bearer token, and a
 * pass-through to the library's own listener for everything under /mcp.
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
        { host: INTERNAL_HOST, port: INTERNAL_PORT, method: req.method, path: req.url, headers: req.headers },
        (upstreamResponse) => {
            res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
            upstreamResponse.pipe(res);
        },
    );
    proxy.on('error', () => {
        if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'text/plain' }); }
        res.end('Bad gateway');
    });
    req.pipe(proxy);
});

await server.run({ transport: 'http', host: INTERNAL_HOST, port: INTERNAL_PORT });
front.listen(PUBLIC_PORT, '0.0.0.0');
