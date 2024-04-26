//@ts-check

import fs from 'fs';
import { defineConfig } from '@vscode/test-cli';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { configureWorkspace } from './out/test/setup';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function generateConfig() {
    const { workspaceFolder, userDataDir } = configureWorkspace();
    /** @type {import('@vscode/test-cli').TestConfiguration} */
    let config = {
        label: 'Extension Test',
        files: ['out/**/*.test.js'],
        version: 'insiders',
        srcDir: 'src',
        workspaceFolder: `${__dirname}/src/test`,
        launchArgs: [workspaceFolder, '--user-data-dir', userDataDir],
        // installExtensions: ['ms-python.vscode-pylance@prerelease']
    };

    config.mocha = {
        ui: 'tdd',
        color: true,
        timeout: 120_000,
    };

    return config;
}

export default defineConfig(generateConfig());
