//@ts-check

import { defineConfig } from '@vscode/test-cli';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function generateConfig() {
    /** @type {import('@vscode/test-cli').TestConfiguration} */
    let config = {
        label: 'Extension Test',
        files: ['out/**/*.vscode.test.js', 'out/**/*.vscode.common.test.js'],
        version: 'insiders',
        srcDir: 'src',
        workspaceFolder: `${__dirname}/src/test/datascience`,
        launchArgs: ['--enable-proposed-api'],
        env: {
            VSC_JUPYTER_FORCE_LOGGING: '1',
            CI_PYTHON_PATH: '', // Update with path to real python interpereter used for testing.
            XVSC_JUPYTER_INSTRUMENT_CODE_FOR_COVERAGE: '1',
            XVSC_JUPYTER_INSTRUMENT_CODE_FOR_COVERAGE_HTML: '1', //Enable to get full coverage repor (in coverage folder).
            VSC_JUPYTER_EXPOSE_SVC: '1'
        }
        // can not use Insiders if it's already running ;(
        // useInstallation: {
        //     fromMachine: true
        // }
    };

    config.mocha = {
        ui: 'tdd',
        color: true,
        timeout: 25000,
        preload: `${__dirname}/out/platform/ioc/reflectMetadata.js`
    };

    return config;
}

export default defineConfig(generateConfig());
