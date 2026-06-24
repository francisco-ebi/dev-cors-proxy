"use strict";

const express = require("express");
const { Readable } = require("node:stream");

const DEFAULT_OPTIONS = {
  bindHost: "127.0.0.1",
  credentials: false,
  origin: "*",
  port: 8010,
  proxyPartial: "proxy"
};

const HELP_TEXT = `Usage: lcp --proxyUrl <url> [options]

Options:
  --proxyUrl <url>         Upstream base URL to proxy to. Required.
  --proxyPartial <path>    Route prefix used by the local proxy. Default: proxy
  --port <number>          Local listening port. Default: 8010
  --credentials            Enable Access-Control-Allow-Credentials
  --origin <origin>        Allowed CORS origin. Default: *
  --help                   Show this help text
`;

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host"
]);

function appendVaryHeader(response, value) {
  const current = response.getHeader("Vary");

  if (!current) {
    response.setHeader("Vary", value);
    return;
  }

  const existing = Array.isArray(current) ? current.join(", ") : String(current);
  const values = new Set(
    existing
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
  values.add(value);
  response.setHeader("Vary", Array.from(values).join(", "));
}

function joinUrlPaths(basePath, extraPath) {
  const normalizedBase = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  const normalizedExtra = extraPath.startsWith("/") ? extraPath : `/${extraPath}`;

  if (normalizedExtra === "/") {
    return normalizedBase || "/";
  }

  return `${normalizedBase}${normalizedExtra}` || "/";
}

function buildTargetUrl(proxyUrl, proxyPartial, originalUrl) {
  const parsedProxyUrl = new URL(proxyUrl);
  const mountPath = `/${proxyPartial}`;
  const proxiedPath = originalUrl.startsWith(mountPath)
    ? originalUrl.slice(mountPath.length) || "/"
    : originalUrl;
  const requestUrl = new URL(proxiedPath, "http://localhost");

  parsedProxyUrl.pathname = joinUrlPaths(parsedProxyUrl.pathname, requestUrl.pathname);
  parsedProxyUrl.search = requestUrl.search;

  return parsedProxyUrl.toString();
}

function normalizeOptions(options = {}) {
  if (!options.proxyUrl) {
    throw new Error("Missing required option: --proxyUrl");
  }

  let parsedProxyUrl;

  try {
    parsedProxyUrl = new URL(options.proxyUrl);
  } catch {
    throw new Error(`Invalid value for --proxyUrl: ${options.proxyUrl}`);
  }

  const port = options.port === undefined ? DEFAULT_OPTIONS.port : Number(options.port);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid value for --port: ${options.port}`);
  }

  const proxyPartial = String(options.proxyPartial ?? DEFAULT_OPTIONS.proxyPartial).replace(
    /^\/+|\/+$/g,
    ""
  );

  if (!proxyPartial) {
    throw new Error("Invalid value for --proxyPartial: value must not be empty");
  }

  const origin = options.origin ?? DEFAULT_OPTIONS.origin;

  if (origin !== "*") {
    try {
      new URL(origin);
    } catch {
      throw new Error(`Invalid value for --origin: ${origin}`);
    }
  }

  return {
    bindHost: DEFAULT_OPTIONS.bindHost,
    credentials: Boolean(options.credentials),
    origin,
    port,
    proxyPartial,
    proxyUrl: parsedProxyUrl.toString()
  };
}

function parseCliArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--help" || argument === "-h") {
      return { help: true };
    }

    if (argument === "--credentials") {
      parsed.credentials = true;
      continue;
    }

    const value = argv[index + 1];

    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }

    switch (argument) {
      case "--proxyUrl":
        parsed.proxyUrl = value;
        index += 1;
        break;
      case "--proxyPartial":
        parsed.proxyPartial = value;
        index += 1;
        break;
      case "--port":
        parsed.port = value;
        index += 1;
        break;
      case "--origin":
        parsed.origin = value;
        index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${argument}`);
    }
  }

  return normalizeOptions(parsed);
}

function setCorsHeaders(request, response, options) {
  const requestOrigin = request.headers.origin;

  if (options.origin === "*") {
    if (options.credentials && requestOrigin) {
      response.setHeader("Access-Control-Allow-Origin", requestOrigin);
      appendVaryHeader(response, "Origin");
    } else {
      response.setHeader("Access-Control-Allow-Origin", "*");
    }
  } else {
    response.setHeader("Access-Control-Allow-Origin", options.origin);
    appendVaryHeader(response, "Origin");
  }

  response.setHeader(
    "Access-Control-Allow-Methods",
    "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS"
  );

  if (request.headers["access-control-request-headers"]) {
    response.setHeader(
      "Access-Control-Allow-Headers",
      request.headers["access-control-request-headers"]
    );
    appendVaryHeader(response, "Access-Control-Request-Headers");
  } else {
    response.setHeader(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization"
    );
  }

  if (options.credentials) {
    response.setHeader("Access-Control-Allow-Credentials", "true");
  }
}

function copyRequestHeaders(request) {
  const headers = new Headers();

  for (const [key, value] of Object.entries(request.headers)) {
    const normalizedKey = key.toLowerCase();

    if (
      value === undefined ||
      HOP_BY_HOP_HEADERS.has(normalizedKey) ||
      normalizedKey === "accept-encoding"
    ) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(key, entry);
      }
      continue;
    }

    headers.set(key, value);
  }

  // Node's fetch transparently decodes compressed upstream responses. Asking for
  // identity encoding avoids sending a decoded body with stale compression headers.
  headers.set("accept-encoding", "identity");

  return headers;
}

function copyResponseHeaders(upstreamResponse, response) {
  const isEncodedResponse = upstreamResponse.headers.has("content-encoding");

  for (const [key, value] of upstreamResponse.headers) {
    const normalizedKey = key.toLowerCase();

    if (HOP_BY_HOP_HEADERS.has(normalizedKey)) {
      continue;
    }

    if (isEncodedResponse && (normalizedKey === "content-encoding" || normalizedKey === "content-length")) {
      continue;
    }

    response.setHeader(key, value);
  }
}

function createProxyApp(options) {
  const normalizedOptions = normalizeOptions(options);
  const app = express();
  const mountPath = `/${normalizedOptions.proxyPartial}`;

  app.use((request, response, next) => {
    setCorsHeaders(request, response, normalizedOptions);

    if (request.method === "OPTIONS") {
      response.status(204).end();
      return;
    }

    next();
  });

  app.get("/", (_request, response) => {
    response.json({
      credentials: normalizedOptions.credentials,
      host: normalizedOptions.bindHost,
      origin: normalizedOptions.origin,
      port: normalizedOptions.port,
      proxyPartial: normalizedOptions.proxyPartial,
      proxyUrl: normalizedOptions.proxyUrl,
      status: "ok"
    });
  });

  app.use(mountPath, async (request, response, next) => {
    try {
      const targetUrl = buildTargetUrl(
        normalizedOptions.proxyUrl,
        normalizedOptions.proxyPartial,
        request.originalUrl
      );

      const upstreamResponse = await fetch(targetUrl, {
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request,
        duplex: request.method === "GET" || request.method === "HEAD" ? undefined : "half",
        headers: copyRequestHeaders(request),
        method: request.method,
        redirect: "manual"
      });

      copyResponseHeaders(upstreamResponse, response);
      setCorsHeaders(request, response, normalizedOptions);
      response.status(upstreamResponse.status);

      if (!upstreamResponse.body) {
        response.end();
        return;
      }

      Readable.fromWeb(upstreamResponse.body).pipe(response);
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _request, response, _next) => {
    if (response.headersSent) {
      response.end();
      return;
    }

    response.status(502).json({
      error: "proxy_error",
      message: error.message
    });
  });

  return {
    app,
    normalizedOptions
  };
}

function startProxy(options) {
  const { app, normalizedOptions } = createProxyApp(options);

  return new Promise((resolve, reject) => {
    const server = app.listen(normalizedOptions.port, normalizedOptions.bindHost, () => {
      resolve({
        app,
        normalizedOptions,
        server
      });
    });

    server.on("error", reject);
  });
}

function formatHelp() {
  return HELP_TEXT;
}

module.exports = {
  DEFAULT_OPTIONS,
  buildTargetUrl,
  createProxyApp,
  formatHelp,
  normalizeOptions,
  parseCliArgs,
  startProxy
};
