// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from '../platform/vscode-path/path';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from './constants.node';

/**
 * Rebuilds all other files with coverage instrumentations
 */
export function setupCoverage() {
    // In case of running integration tests like DS test with VS Code UI, we have no other way to add coverage.
    // In such a case we need to instrument the code for coverage.
    if (!process.env.VSC_JUPYTER_INSTRUMENT_CODE_FOR_COVERAGE) {
        return;
    }
    const htmlReport = process.env.VSC_JUPYTER_INSTRUMENT_CODE_FOR_COVERAGE_HTML ? ['html'] : [];
    const reports = htmlReport.concat(['text', 'text-summary']);
    const NYC = require('nyc');
    const nyc = new NYC({
        cwd: path.join(EXTENSION_ROOT_DIR_FOR_TESTS),
        extension: ['.ts'],
        include: ['**/src/**/*.ts', '**/out/**/*.js'],
        exclude: ['**/test/**', '.vscode-test/**', '**/ipywidgets/**', '**/node_modules/**'],
        reporter: reports,
        'report-dir': path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'coverage'),
        all: true,
        instrument: true,
        hookRequire: true,
        hookRunInContext: true,
        hookRunInThisContext: true,
        excludeNodeModules: true,
        sourceMap: true
    });

    nyc.reset();
    nyc.wrap();

    return nyc as { writeCoverageFile: Function; report: () => Promise<void> };
}
