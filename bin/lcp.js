#!/usr/bin/env node

const { formatHelp, parseCliArgs, startProxy } = require("../lib");

async function main() {
  try {
    const options = parseCliArgs(process.argv.slice(2));

    if (options.help) {
      process.stdout.write(`${formatHelp()}\n`);
      process.exit(0);
    }

    const { normalizedOptions } = await startProxy(options);
    process.stdout.write(
      `Local CORS proxy running on http://${normalizedOptions.bindHost}:${normalizedOptions.port}/${normalizedOptions.proxyPartial}\n`
    );
    process.stdout.write(`Proxying requests to ${normalizedOptions.proxyUrl}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${formatHelp()}\n`);
    process.exit(1);
  }
}

main();
