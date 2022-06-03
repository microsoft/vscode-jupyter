// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { commands, NotebookDocument, Uri, workspace } from 'vscode';
import { IDisposable } from '../platform/common/types';
import { initializeCommonApi } from './common';
import { JUPYTER_SERVER_URI } from './constants';
import * as uuid from 'uuid/v4';
import { noop } from './core';
import { initialize } from './initialize';

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
        async startJupyterServer(notebook?: NotebookDocument): Promise<void> {
            // Server URI should have been embedded in the constants file
            const uri = Uri.parse(JUPYTER_SERVER_URI);
            console.log(`ServerURI for remote test: ${JUPYTER_SERVER_URI}`);
            // Use this URI to set our jupyter server URI
            await commands.executeCommand('jupyter.selectjupyteruri', false, uri, notebook);
        },
        async initialize() {
            return initialize();
        }
    });
}
