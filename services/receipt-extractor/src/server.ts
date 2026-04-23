import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";

import { handleDiagnosticsRuntime } from "./routes/diagnostics-runtime";
import { handleExtractReceipt, handleExtractReceiptFromRawPayload } from "./routes/extract-receipt";
import { handleHealthz } from "./routes/healthz";

const port = Number(process.env.PORT || 4300);

function toWebRequest(req: IncomingMessage) {
  const protocol = (req.headers["x-forwarded-proto"] as string) || "http";
  const host = req.headers.host || `127.0.0.1:${port}`;
  const url = `${protocol}://${host}${req.url || "/"}`;

  const headers = new Headers();
  Object.entries(req.headers).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => headers.append(key, entry));
      return;
    }
    if (typeof value === "string") {
      headers.set(key, value);
    }
  });

  const method = (req.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") {
    return new Request(url, {
      method,
      headers
    });
  }

  const bodyStream = Readable.toWeb(req) as ReadableStream<Uint8Array>;
  return new Request(url, {
    method,
    headers,
    body: bodyStream,
    // Node fetch requires duplex for stream request bodies.
    duplex: "half"
  } as RequestInit & { duplex: "half" });
}

async function sendWebResponse(res: ServerResponse, response: Response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (response.body) {
    const arrayBuffer = await response.arrayBuffer();
    res.end(Buffer.from(arrayBuffer));
    return;
  }

  res.end();
}

async function routeRequest(request: Request) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method.toUpperCase();

  if (method === "GET" && pathname === "/healthz") {
    return handleHealthz();
  }

  if (method === "GET" && pathname === "/diagnostics/runtime") {
    return handleDiagnosticsRuntime();
  }

  if (method === "POST" && pathname === "/extract-receipt") {
    return handleExtractReceipt(request);
  }

  if (method === "POST" && pathname === "/extract-receipt-from-raw-payload") {
    return handleExtractReceiptFromRawPayload(request);
  }

  return new Response(
    JSON.stringify({
      success: false,
      message: "Not found"
    }),
    {
      status: 404,
      headers: {
        "content-type": "application/json"
      }
    }
  );
}

const server = createServer(async (req, res) => {
  try {
    const request = toWebRequest(req);
    const response = await routeRequest(request);
    await sendWebResponse(res, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        message: "Internal service error",
        error: message
      })
    );
  }
});

server.listen(port, () => {
  console.info(`[receipt-extractor] listening on port ${port}`);
});
