import {
  authenticateMcpRequest,
  bearerChallenge,
} from "../../../lib/mcp-oauth";
import { callMcpTool, mcpTools } from "../../../lib/mcp-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 65_536;
const SUPPORTED_PROTOCOLS = ["2025-11-25", "2025-06-18", "2024-11-05"];

type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: unknown;
};

function responseBody(body: unknown, status = 200, protocol?: string) {
  const headers = new Headers({
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  if (protocol) headers.set("MCP-Protocol-Version", protocol);
  return new Response(JSON.stringify(body), { status, headers });
}

function result(id: JsonRpcRequest["id"], value: unknown, protocol?: string) {
  return responseBody({ jsonrpc: "2.0", id: id ?? null, result: value }, 200, protocol);
}

function rpcError(
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
  status = 200,
  protocol?: string,
) {
  return responseBody(
    { jsonrpc: "2.0", id: id ?? null, error: { code, message } },
    status,
    protocol,
  );
}

function unauthorized(request: Request) {
  return responseBody(
    { error: "unauthorized", error_description: "A valid OAuth access token is required." },
    401,
  );
}

export async function POST(request: Request) {
  const access = await authenticateMcpRequest(request);
  if (!access) {
    const response = unauthorized(request);
    response.headers.set("WWW-Authenticate", bearerChallenge(request));
    return response;
  }

  const length = Number(request.headers.get("content-length") || "0");
  if (length > MAX_REQUEST_BYTES) {
    return rpcError(null, -32600, "Request too large.", 413);
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
    return rpcError(null, -32600, "Request too large.", 413);
  }

  let message: JsonRpcRequest;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return rpcError(null, -32600, "Invalid Request.");
    }
    message = parsed as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, "Parse error.");
  }

  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return rpcError(message.id, -32600, "Invalid Request.");
  }

  const requestedProtocol = request.headers.get("MCP-Protocol-Version") || "";
  const protocol = SUPPORTED_PROTOCOLS.includes(requestedProtocol)
    ? requestedProtocol
    : SUPPORTED_PROTOCOLS[0];

  if (message.method === "notifications/initialized") {
    return new Response(null, { status: 202 });
  }

  if (message.method === "initialize") {
    const params =
      message.params && typeof message.params === "object" && !Array.isArray(message.params)
        ? (message.params as Record<string, unknown>)
        : {};
    const clientProtocol =
      typeof params.protocolVersion === "string" ? params.protocolVersion : "";
    const negotiated = SUPPORTED_PROTOCOLS.includes(clientProtocol)
      ? clientProtocol
      : SUPPORTED_PROTOCOLS[0];
    return result(
      message.id,
      {
        protocolVersion: negotiated,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "minilytics", version: "0.4.0" },
        instructions:
          "Read-only analytics for the owner's Minilytics projects. Use list_sites first, then query overview, traffic, acquisition, content or journeys.",
      },
      negotiated,
    );
  }

  if (message.method === "ping") {
    return result(message.id, {}, protocol);
  }

  if (message.method === "tools/list") {
    return result(message.id, { tools: mcpTools }, protocol);
  }

  if (message.method === "tools/call") {
    const params =
      message.params && typeof message.params === "object" && !Array.isArray(message.params)
        ? (message.params as Record<string, unknown>)
        : {};
    const name = typeof params.name === "string" ? params.name : "";
    const args =
      params.arguments &&
      typeof params.arguments === "object" &&
      !Array.isArray(params.arguments)
        ? (params.arguments as Record<string, unknown>)
        : {};
    if (!name) return rpcError(message.id, -32602, "Tool name is required.", 200, protocol);

    try {
      const output = await callMcpTool(name, args);
      return result(
        message.id,
        {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
          isError: false,
        },
        protocol,
      );
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Tool failed.";
      return result(
        message.id,
        {
          content: [{ type: "text", text: messageText }],
          isError: true,
        },
        protocol,
      );
    }
  }

  return rpcError(message.id, -32601, "Method not found.", 200, protocol);
}

export function GET() {
  return new Response("Minilytics MCP uses authenticated HTTP POST requests.", {
    status: 405,
    headers: { allow: "POST, OPTIONS" },
  });
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      allow: "POST, OPTIONS",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
      "access-control-allow-methods": "POST, OPTIONS",
    },
  });
}
