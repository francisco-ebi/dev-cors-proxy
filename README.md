# dev-cors-proxy

Maintained local development CORS proxy with an `lcp`-compatible CLI. This project is a modernized clone of [`garmeeh/local-cors-proxy`](https://github.com/garmeeh/local-cors-proxy), rebuilt so the dependency surface stays small and easy to update.

## Status

- Compatible CLI flags: `--proxyUrl`, `--proxyPartial`, `--port`, `--credentials`, `--origin`
- Package manager: `pnpm`
- Runtime baseline: Node.js 20+
- Publish target: npm public package

## Install

```bash
pnpm install
```

Global usage after publish:

```bash
pnpm add -g dev-cors-proxy
lcp --proxyUrl https://www.yourdomain.ie
```

Local usage during development:

```bash
pnpm start -- --proxyUrl https://www.yourdomain.ie
```

## Example

API endpoint with CORS issues:

```text
https://www.yourdomain.ie/movies/list
```

Start the proxy:

```bash
lcp --proxyUrl https://www.yourdomain.ie
```

Call the proxied endpoint from your client:

```text
http://127.0.0.1:8010/proxy/movies/list
```

## Options

| Option | Example | Default |
| --- | --- | --- |
| `--proxyUrl` | `https://www.google.ie` | required |
| `--proxyPartial` | `foo` | `proxy` |
| `--port` | `8010` | `8010` |
| `--credentials` | no value required | `false` |
| `--origin` | `http://localhost:4200` | `*` |

## Development

```bash
pnpm test
```

Before the first publish, update these `package.json` fields to your real values:

- `author`
- `repository`
- `bugs`
- `homepage`

Review the tarball contents before publishing:

```bash
npm pack --dry-run
```

Manual publish:

```bash
npm publish --access public
```

## Release automation

GitHub Actions workflow: `.github/workflows/publish.yml`

- Trigger a publish by pushing a version tag such as `v0.1.0`
- The workflow verifies the tag matches `package.json`
- Publishing uses npm trusted publishing with provenance, not a long-lived npm token
