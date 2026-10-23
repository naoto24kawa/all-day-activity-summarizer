import { createServer, request as httpRequest } from "node:http";
import { type APIRequestContext, type APIResponse, expect, test } from "@playwright/test";

const headers = {
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
};
const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "http-security-test", version: "1.0.0" },
  },
};

let apiCalls = 0;
const api = createServer(async (req, res) => {
  apiCalls++;
  if (req.method !== "PATCH" || req.url !== "/api/calendar/mark-read") {
    res.writeHead(404).end();
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString());
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ updated: body.ids.length }));
});

test.beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    api.once("error", reject);
    api.listen(43052, "127.0.0.1", resolve);
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    api.close((error) => (error ? reject(error) : resolve()));
  });
});

async function readRpc(response: APIResponse) {
  expect(response.status()).toBe(200);
  const body = await response.text();
  const data = body.split("\n").find((line) => line.startsWith("data: "));
  expect(data).toBeDefined();
  return JSON.parse(data?.slice(6) ?? "");
}

async function startSession(request: APIRequestContext) {
  const response = await request.post("/mcp", { headers, data: initialize });
  expect((await readRpc(response)).result.serverInfo.name).toBe("adas");
  const sessionId = response.headers()["mcp-session-id"];
  expect(sessionId).toBeTruthy();
  return { ...headers, "mcp-session-id": sessionId, "mcp-protocol-version": "2025-11-25" };
}

test("初期化したセッション → ツール一覧を取得できる", async ({ request }) => {
  const sessionHeaders = await startSession(request);
  const response = await request.post("/mcp", {
    headers: sessionHeaders,
    data: { jsonrpc: "2.0", id: 2, method: "tools/list" },
  });
  const result = await readRpc(response);
  expect(result.result.tools).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: "mark_calendar_read" })]),
  );
});

test("引数がちょうど10,000要素 → ツールを実行できる", async ({ request }) => {
  const sessionHeaders = await startSession(request);
  const response = await request.post("/mcp", {
    headers: sessionHeaders,
    data: {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "mark_calendar_read", arguments: { ids: Array(9_999).fill(1) } },
    },
  });
  const result = (await readRpc(response)).result;
  expect(result.isError).not.toBe(true);
  expect(result.content).toEqual([{ type: "text", text: "9999件のイベントを既読にしました。" }]);
});

for (const [kind, args] of [
  ["配列要素", { ids: Array(10_000).fill(1) }],
  [
    "オブジェクトキー",
    { ids: [1], extra: Object.fromEntries(Array.from({ length: 10_000 }, (_, i) => [`k${i}`, 1])) },
  ],
] as const) {
  test(`${kind}で10,000要素を超える引数 → isErrorで拒否しAPIを呼ばない`, async ({ request }) => {
    const sessionHeaders = await startSession(request);
    const callsBefore = apiCalls;
    const response = await request.post("/mcp", {
      headers: sessionHeaders,
      data: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "mark_calendar_read", arguments: args },
      },
    });
    expect((await readRpc(response)).result.isError).toBe(true);
    expect(apiCalls).toBe(callsBefore);
  });
}

function paddedBody(
  message: { jsonrpc: string; id: number; method: string; params?: object },
  bytes: number,
): string {
  const payload = { ...message, params: { ...message.params, _meta: { padding: "" } } };
  payload.params._meta.padding = "x".repeat(bytes - Buffer.byteLength(JSON.stringify(payload)));
  return JSON.stringify(payload);
}

test("bodyがちょうど1MiB → ツール一覧を取得できる", async ({ request }) => {
  const sessionHeaders = await startSession(request);
  const response = await request.post("/mcp", {
    headers: sessionHeaders,
    data: paddedBody({ jsonrpc: "2.0", id: 2, method: "tools/list" }, 1_048_576),
  });
  expect((await readRpc(response)).result.tools.length).toBeGreaterThan(0);
});

for (const session of [false, true]) {
  test(`${session ? "既存セッション" : "初期化"}でbodyが1MiB超 → HTTP 413で拒否する`, async ({
    request,
  }) => {
    const requestHeaders = session ? await startSession(request) : headers;
    const message = session ? { jsonrpc: "2.0", id: 2, method: "tools/list" } : initialize;
    const response = await request.post("/mcp", {
      headers: requestHeaders,
      data: paddedBody(message, 1_048_577),
    });
    expect(response.status()).toBe(413);
  });
}

test("Content-Lengthのないbodyが1MiB超 → HTTP 413で拒否する", async ({ request }) => {
  const sessionHeaders = await startSession(request);
  const body = paddedBody({ jsonrpc: "2.0", id: 2, method: "tools/list" }, 1_048_577);
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const req = httpRequest(
      "http://127.0.0.1:43051/mcp",
      {
        method: "POST",
        headers: sessionHeaders,
        timeout: 5_000,
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("HTTP要求がタイムアウトしました")));
    req.write(body.slice(0, 512_000));
    req.end(body.slice(512_000));
  });
  expect(status).toBe(413);
});
