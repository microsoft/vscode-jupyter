// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from '../../platform/vscode-path/path';
import * as fs from 'fs-extra';
import { DebuggerType, sharedIWDebuggerTests } from './interactiveDebugging.vscode.common';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../constants.node';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('Interactive Window Debugging @debugger', function () {
    const settingsFile = path.join(
        EXTENSION_ROOT_DIR_FOR_TESTS,
        'src',
        'test',
        'datascience',
        '.vscode',
        'settings.json'
    );
    async function enableJupyterDebugger(debuggerType: DebuggerType) {
        const enable = debuggerType === 'JupyterProtocolDebugger';
        const settingFileContents = fs.readFileSync(settingsFile).toString();
        if (enable && settingFileContents.includes(`"jupyter.forceIPyKernelDebugger": true`)) {
            return;
        } else if (enable && settingFileContents.includes(`"jupyter.forceIPyKernelDebugger": false`)) {
            fs.writeFileSync(
                settingsFile,
                settingFileContents.replace(
                    `"jupyter.forceIPyKernelDebugger": false`,
                    `"jupyter.forceIPyKernelDebugger": true`
                )
            );
            return;
        } else if (enable && !settingFileContents.includes(`"jupyter.forceIPyKernelDebugger": true`)) {
            throw new Error('Unable to update settings file');
        } else if (!enable && settingFileContents.includes(`"jupyter.forceIPyKernelDebugger": true`)) {
            fs.writeFileSync(
                settingsFile,
                settingFileContents.replace(
                    `"jupyter.forceIPyKernelDebugger": true`,
                    `"jupyter.forceIPyKernelDebugger": false`
                )
            );
            return;
        } else if (!enable && settingFileContents.includes(`"jupyter.forceIPyKernelDebugger": false`)) {
            return;
        } else if (!enable && !settingFileContents.includes(`"jupyter.forceIPyKernelDebugger": true`)) {
            throw new Error('Unable to update settings file');
        }
    }
    sharedIWDebuggerTests.bind(this)({ suiteSetup: enableJupyterDebugger });
});
