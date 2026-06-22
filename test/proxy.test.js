"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const {
  buildTargetUrl,
  createProxyApp,
  normalizeOptions,
  parseCliArgs
} = require("../lib");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(server);
    });
    server.on("error", reject);
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

test("parseCliArgs reads the upstream-compatible flags", () => {
  const options = parseCliArgs([
    "--proxyUrl",
    "https://example.com/api",
    "--proxyPartial",
    "foo",
    "--port",
    "9000",
    "--credentials",
    "--origin",
    "http://localhost:3000"
  ]);

  assert.equal(options.proxyUrl, "https://example.com/api");
  assert.equal(options.proxyPartial, "foo");
  assert.equal(options.port, 9000);
  assert.equal(options.credentials, true);
  assert.equal(options.origin, "http://localhost:3000");
});

test("normalizeOptions rejects missing proxyUrl", () => {
  assert.throws(() => normalizeOptions({}), /--proxyUrl/);
});

test("buildTargetUrl preserves the upstream base path", () => {
  const targetUrl = buildTargetUrl(
    "https://example.com/base",
    "proxy",
    "/proxy/movies/list?limit=10"
  );

  assert.equal(targetUrl, "https://example.com/base/movies/list?limit=10");
});

test("proxy forwards requests and returns permissive CORS headers by default", async () => {
  const upstreamServer = await listen(
    http.createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          method: request.method,
          url: request.url
        })
      );
    })
  );

  const upstreamPort = upstreamServer.address().port;
  const { app } = createProxyApp({
    proxyUrl: `http://127.0.0.1:${upstreamPort}/api`
  });
  const proxyServer = await listen(http.createServer(app));
  const proxyPort = proxyServer.address().port;

  try {
    const response = await fetch(
      `http://127.0.0.1:${proxyPort}/proxy/movies/list?limit=10`,
      {
        headers: {
          Origin: "http://localhost:3000"
        }
      }
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.equal(payload.url, "/api/movies/list?limit=10");
  } finally {
    await close(proxyServer);
    await close(upstreamServer);
  }
});

test("credentials mode reflects the request origin", async () => {
  const upstreamServer = await listen(
    http.createServer((_request, response) => {
      response.end("ok");
    })
  );

  const upstreamPort = upstreamServer.address().port;
  const { app } = createProxyApp({
    credentials: true,
    proxyUrl: `http://127.0.0.1:${upstreamPort}`
  });
  const proxyServer = await listen(http.createServer(app));
  const proxyPort = proxyServer.address().port;

  try {
    const response = await fetch(`http://127.0.0.1:${proxyPort}/proxy/status`, {
      headers: {
        Origin: "http://localhost:5173"
      }
    });

    assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:5173");
    assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  } finally {
    await close(proxyServer);
    await close(upstreamServer);
  }
});

test("custom proxyPartial changes the local route prefix", async () => {
  const upstreamServer = await listen(
    http.createServer((request, response) => {
      response.end(request.url);
    })
  );

  const upstreamPort = upstreamServer.address().port;
  const { app } = createProxyApp({
    proxyPartial: "edge",
    proxyUrl: `http://127.0.0.1:${upstreamPort}`
  });
  const proxyServer = await listen(http.createServer(app));
  const proxyPort = proxyServer.address().port;

  try {
    const response = await fetch(`http://127.0.0.1:${proxyPort}/edge/hello`);
    const body = await response.text();

    assert.equal(body, "/hello");
  } finally {
    await close(proxyServer);
    await close(upstreamServer);
  }
});
