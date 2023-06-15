// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { commands, Uri, workspace } from 'vscode';
import { IDisposable } from '../platform/common/types';
import { generateScreenShotFileName, initializeCommonApi } from './common';
import { JUPYTER_SERVER_URI } from './constants';
import uuid from 'uuid/v4';
import { noop } from './core';
import { initialize } from './initialize';
import { isCI } from '../platform/common/constants';
import { ClientAPI } from './web/clientApi';

/**
 * Captures screenshots (png format) & dumpts into root directory (only on CI).
 * If there's a failure, it will be logged (errors are swallowed).
 */
async function captureScreenShot(contextOrFileName: string | Mocha.Context) {
    if (!isCI) {
        return;
    }
    const filename = await generateScreenShotFileName(contextOrFileName);
    try {
        await ClientAPI.captureScreenShot(filename);
        console.info(`Screenshot captured into ${filename}`);
    } catch (ex) {
        console.error(`Failed to capture screenshot into ${filename}`, ex);
    }
}

export function initializeCommonWebApi() {
    initializeCommonApi({
        async createTemporaryFile(options: {
            contents?: string;
            extension: string;
        }): Promise<{ file: Uri } & IDisposable> {
            const folder = workspace.workspaceFolders![0].uri;
            const tmpDir = Uri.joinPath(folder, 'temp', 'testFiles');
            try {
                await workspace.fs.createDirectory(tmpDir);
            } catch {
                // ignore if it exists..
            }
            const extension = options.extension || '.py';
            const file = Uri.joinPath(tmpDir, `${uuid()}${extension}`);
            const contents = options.contents || '';

            await workspace.fs.writeFile(file, Buffer.from(contents));
            return {
                file,
                dispose: () => {
                    workspace.fs.delete(file).then(noop, noop);
                }
            };
        },
        async startJupyterServer(_options?: {
            token?: string;
            port?: number;
            useCert?: boolean;
            jupyterLab?: boolean;
            password?: string;
        }): Promise<{ url: string } & IDisposable> {
            // DEBUG_JUPYTER_SERVER_URI is not a valid setting, but updated when we launch the tests via vscode debugger.
            const url = workspace.getConfiguration('jupyter').get('DEBUG_JUPYTER_SERVER_URI', JUPYTER_SERVER_URI);
            console.log(`ServerURI for remote test: ${url}`);
            // Server URI should have been embedded in the constants file
            const uri = Uri.parse(url);
            // Use this URI to set our jupyter server URI
            await commands.executeCommand('jupyter.selectjupyteruri', uri);
            return { url: url, dispose: noop };
        },
        async initialize() {
            return initialize();
        },
        captureScreenShot
    });
}
