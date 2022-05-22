// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports, no-invalid-this, @typescript-eslint/no-explicit-any */

import * as fs from 'fs-extra';
import * as path from '../../../platform/vscode-path/path';
import * as tmp from 'tmp';
import { IDisposable } from '../../../platform/common/types';
import { noop, swallowExceptions } from '../../../platform/common/utils/misc';
import { IS_REMOTE_NATIVE_TEST } from '../../constants.node';
import { commands, NotebookDocument, Uri } from 'vscode';
import { traceInfo } from '../../../platform/logging';
import { JupyterServer } from '../jupyterServer.node';
export * from './helper';

export async function createTemporaryFile(options: {
    templateFile?: string;
    contents?: string;
    extension?: string;
    dir?: string;
}): Promise<{ file: string } & IDisposable> {
    const extension = options.templateFile ? path.extname(options.templateFile) : options.extension || '.py';
    const tempFile = tmp.tmpNameSync({ postfix: extension, dir: options.dir });
    if (options.templateFile) {
        await fs.copyFile(options.templateFile, tempFile);
    } else if (options.contents) {
        await fs.writeFile(tempFile, options.contents);
    }
    return { file: tempFile, dispose: () => swallowExceptions(() => fs.unlinkSync(tempFile)) };
}

export async function startJupyterServer(notebook?: NotebookDocument, useCert: boolean = false): Promise<any> {
    if (IS_REMOTE_NATIVE_TEST()) {
        const uriString = useCert
            ? await JupyterServer.instance.startJupyterWithCert()
            : await JupyterServer.instance.startJupyterWithToken();
        traceInfo(`Jupyter started and listening at ${uriString}`);
        return commands.executeCommand('jupyter.selectjupyteruri', false, Uri.parse(uriString), notebook);
    } else {
        traceInfo(`Jupyter not started and set to local`); // This is the default
    }
}

export async function stopJupyterServer() {
    if (IS_REMOTE_NATIVE_TEST()) {
        return;
    }
    await JupyterServer.instance.dispose().catch(noop);
}
