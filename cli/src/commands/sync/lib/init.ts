import { dirname } from 'node:path';

import type { ConfigFile } from '../config/config.js';
import {
  RULESYNC_CONFIG_RELATIVE_FILE_PATH,
  RULESYNC_CONFIG_SCHEMA_URL,
} from '../constants/rulesync-paths.js';
import { ensureDir, fileExists, writeFileContent } from '../utils/file.js';
import { createFeatureScaffold } from './feature-scaffold.js';

type InitFileResult = {
  created: boolean;
  path: string;
};

export type InitResult = {
  configFile: InitFileResult;
  sampleFiles: InitFileResult[];
};

/** Initialize `.transcodes/` configuration and sample files. */
export async function init(): Promise<InitResult> {
  const sampleFiles = await createSampleFiles();
  const configFile = await createConfigFile();
  return { configFile, sampleFiles };
}

async function createConfigFile(): Promise<InitFileResult> {
  const path = RULESYNC_CONFIG_RELATIVE_FILE_PATH;
  if (await fileExists(path)) {
    return { created: false, path };
  }

  await ensureDir(dirname(path));
  await writeFileContent(
    path,
    `${JSON.stringify(
      {
        $schema: RULESYNC_CONFIG_SCHEMA_URL,
        targets: [
          'claudecode',
          'codexcli',
          'cursor',
          'antigravity-ide',
          'agentsmd',
        ],
        features: ['rules', 'skills'],
        outputRoots: ['.'],
        delete: true,
        verbose: false,
        silent: false,
        global: false,
        simulateSkills: false,
        gitignoreTargetsOnly: true,
      } satisfies ConfigFile,
      null,
      2,
    )}\n`,
  );
  return { created: true, path };
}

async function createSampleFiles(): Promise<InitFileResult[]> {
  const samples = [
    createFeatureScaffold({ feature: 'rule', name: 'agents' }),
    createFeatureScaffold({ feature: 'skill', name: 'project-context' }),
  ];

  const results: InitFileResult[] = [];
  for (const sample of samples) {
    await ensureDir(dirname(sample.relativeFilePath));
    if (await fileExists(sample.relativeFilePath)) {
      results.push({ created: false, path: sample.relativeFilePath });
      continue;
    }
    await writeFileContent(sample.relativeFilePath, sample.content);
    results.push({ created: true, path: sample.relativeFilePath });
  }
  return results;
}
