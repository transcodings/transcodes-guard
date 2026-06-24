import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkg = require(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'),
) as {
  name: string;
  version: string;
};

/** npm package name (@bigstrider/transcodes-cli). */
export const CLI_PACKAGE_NAME = pkg.name;

/** Semver published to npm — read from cli/package.json at runtime. */
export const CLI_VERSION = pkg.version;
