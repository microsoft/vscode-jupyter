// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// First initialize the extension state.
import { setCI, setTestExecution } from '../../platform/common/constants';
import { setTestSettings } from '../constants';

setCI(true);
setTestExecution(true);
setTestSettings({
    isRemoteNativeTest: true,
    isNonRawNativeTest: true
});

// Now import & load the rest of the extension code.
// At this point, the necessary variables would have been initialized.
// E.g. when extension activates, the isCI would have been set and necessary loggers setup & the like.
import * as extension from '../../extension.web';
import * as vscode from 'vscode';
import type { IExtensionApi } from '../../standalone/api';
import type { IExtensionContext } from '../../platform/common/types';
import { IExtensionTestApi } from '../common';
import { JVSC_EXTENSION_ID } from '../../platform/common/constants';
const CustomReporter = require('./customReporter');
import { sleep } from '../../platform/common/utils/async';

let activatedResponse: undefined | IExtensionApi;

declare var VSC_JUPYTER_CI_TEST_GREP: '';
function getMochaTestGrep() {
    try {
        if (typeof VSC_JUPYTER_CI_TEST_GREP === 'string') {
            console.log('Grep for testing is ', VSC_JUPYTER_CI_TEST_GREP);
            return VSC_JUPYTER_CI_TEST_GREP;
        }
        return '';
    } catch {
        return '';
    }
}

// Basically this is the entry point for the extension.
export async function activate(context: IExtensionContext): Promise<IExtensionApi> {
    if (activatedResponse) {
        return activatedResponse;
    }
    vscode.commands.registerCommand('jupyter.web.runTests', async () => {
        // imports mocha for the browser, defining the `mocha` global.
        require('mocha/mocha');

        return new Promise<void>(async (resolve, reject) => {
            // Check for a grep setting. Might be running a subset of the tests
            const grep = getMochaTestGrep();
            console.log('Grep for Mocha testing is ', grep);
            mocha.setup({
                ui: 'tdd',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                reporter: CustomReporter as any,
                grep
            });

            // bundles all files in the current directory matching `*.web.test` & `*.common.test`
            const importAll = (r: __WebpackModuleApi.RequireContext) => r.keys().forEach(r);
            importAll(require.context('..', true, /\.web\.test$/));
            importAll(require.context('..', true, /\.common\.test$/));

            try {
                // Run the mocha test
                mocha.run(async (failures) => {
                    // Wait for a while, till we've managed to send the test results to the test server.
                    await sleep(5_000);
                    if (failures > 0) {
                        reject(new Error(`${failures} tests failed.`));
                    } else {
                        resolve();
                    }
                });
            } catch (err) {
                console.error(err);
                // Wait for a while, till we've managed to send the test results to the test server.
                await sleep(5_000);
                reject(err);
            }
        });
    });

    activatedResponse = await extension.activate(context);
    return activatedResponse;
}

export async function deactivate(): Promise<void> {
    return extension.deactivate();
}

export async function run(): Promise<void> {
    // Activate the extension so that the commands are registered.
    // Also this will not slow down the suite-setups.
    const extension = vscode.extensions.getExtension<IExtensionTestApi>(JVSC_EXTENSION_ID)!;
    const api = await extension.activate();
    await api.ready;
    // Run the tests from within the context of the extension bundle.
    // We achieve this by getting the extension to run the tests (then its guaranteed to use the same context as the extension).
    await vscode.commands.executeCommand('jupyter.web.runTests');
    console.log('Finished executing tests.');
}
