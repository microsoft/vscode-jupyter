//@ts-check

import fs from 'fs';
import { defineConfig } from '@vscode/test-cli';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function generateConfig() {
    const venvFolder = `${__dirname}/.venv`;
    const pythonPath = fs.existsSync(venvFolder)
        ? process.platform === 'win32'
            ? `${venvFolder}/Scripts/python.exe`
            : `${venvFolder}/bin/python`
        : '';
    const workspaceFolder = join(__dirname, 'src', 'test', 'datascience');
    /** @type {import('@vscode/test-cli').TestConfiguration} */
    let config = {
        label: 'Extension Test',
        files: ['out/**/*.vscode.test.js', 'out/**/*.vscode.common.test.js'],
        version: 'insiders',
        srcDir: 'src',
        workspaceFolder,
        launchArgs: [workspaceFolder, '--enable-proposed-api'],
        env: {
            VSC_JUPYTER_FORCE_LOGGING: '1',
            // VSC_JUPYTER_REMOTE_NATIVE_TEST: 'true',
            // VSC_JUPYTER_NON_RAW_NATIVE_TEST: 'false',
            // VSC_JUPYTER_CI_TEST_GREP: '@widgets',
            CI_PYTHON_PATH: pythonPath,
            XVSC_JUPYTER_INSTRUMENT_CODE_FOR_COVERAGE: '1',
            XVSC_JUPYTER_INSTRUMENT_CODE_FOR_COVERAGE_HTML: '1', //Enable to get full coverage repor (in coverage folder).
            VSC_JUPYTER_EXPOSE_SVC: '1'
        },
        installExtensions: [
            'ms-toolsai.jupyter-renderers',
            'ms-python.vscode-python-envs',
            'ms-python.python',
            'ms-python.vscode-pylance@prerelease'
        ]
    };

    config.mocha = {
        ui: 'tdd',
        color: true,
        timeout: 25000,
        preload: [`${__dirname}/out/platform/ioc/reflectMetadata.js`, `${__dirname}/out/test/common.test.require.js`]
    };

    return config;
}

export default defineConfig(generateConfig());
