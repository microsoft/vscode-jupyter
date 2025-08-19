//@ts-check

import fs from 'fs';
import { defineConfig } from '@vscode/test-cli';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * @param {string} label
 * @param {Record<string, string | undefined>} env
 */
function generateConfig(label, env) {
    const workspaceFolder = join(__dirname, 'src', 'test', 'datascience');
    /** @type {import('@vscode/test-cli').TestConfiguration} */
    let config = {
        label,
        files: ['out/**/*.vscode.test.js', 'out/**/*.vscode.common.test.js'],
        version: 'insiders',
        srcDir: 'src',
        workspaceFolder,
        launchArgs: [workspaceFolder, '--enable-proposed-api'],
        env,
        installExtensions: [
            'ms-toolsai.jupyter-renderers',
            'ms-python.vscode-python-envs',
            'ms-python.python',
            'ms-python.vscode-pylance@prerelease'
        ],
        mocha: {
            ui: 'tdd',
            color: true,
            timeout: 25000,
            preload: [
                `${__dirname}/out/platform/ioc/reflectMetadata.js`,
                `${__dirname}/out/test/common.test.require.js`
            ]
        }
    };

    return config;
}

function generateBasedEnvVariables() {
    const venvFolder = `${__dirname}/.venv`;
    const pythonPath = fs.existsSync(venvFolder)
        ? process.platform === 'win32'
            ? `${venvFolder}/Scripts/python.exe`
            : `${venvFolder}/bin/python`
        : '';
    return {
        CI_PYTHON_PATH: pythonPath,
        // VSC_JUPYTER_FORCE_LOGGING: '1',
        // VSC_JUPYTER_REMOTE_NATIVE_TEST: 'true',
        // VSC_JUPYTER_NON_RAW_NATIVE_TEST: 'false',
        // VSC_JUPYTER_CI_TEST_GREP: '@widgets',
        XVSC_JUPYTER_INSTRUMENT_CODE_FOR_COVERAGE: '1',
        XVSC_JUPYTER_INSTRUMENT_CODE_FOR_COVERAGE_HTML: '1', //Enable to get full coverage repor (in coverage folder).
        VSC_JUPYTER_EXPOSE_SVC: '1'
    };
}

function generateLocalTestConfig() {
    return generateConfig('Local Tests', generateBasedEnvVariables());
}

function generateRemoteTestConfig() {
    const env = Object.assign(generateBasedEnvVariables(), {
        VSC_JUPYTER_REMOTE_NATIVE_TEST: 'true',
        VSC_JUPYTER_NON_RAW_NATIVE_TEST: 'false'
    });
    return generateConfig('Remote Tests', env);
}

export default defineConfig([generateLocalTestConfig(), generateRemoteTestConfig()]);
