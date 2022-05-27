/* eslint-disable local-rules/dont-use-fspath */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Uri, workspace, window, commands } from 'vscode';
import { IWorkspaceService } from '../../platform/common/application/types';
import { getFilePath } from '../../platform/common/platform/fs-paths';
import { IPlatformService } from '../../platform/common/platform/types';
import { IDisposable } from '../../platform/common/types';
import { swallowExceptions } from '../../platform/common/utils/misc';
import { traceInfo } from '../../platform/logging';
import * as urlPath from '../../platform/vscode-path/resources';
import * as uuid from 'uuid/v4';
import { defaultNotebookTestTimeout, getServices } from './notebook/helper';
import { IInteractiveWindow, IInteractiveWindowProvider } from '../../interactive-window/types';
import { waitForCondition } from '../common';

export async function openNotebook(ipynbFile: Uri) {
    traceInfo(`Opening notebook ${getFilePath(ipynbFile)}`);
    const nb = await workspace.openNotebookDocument(ipynbFile);
    await window.showNotebookDocument(nb);
    traceInfo(`Opened notebook ${getFilePath(ipynbFile)}`);
    return nb;
}

export async function createTemporaryPythonFile(contents: string, disposables: IDisposable[]) {
    const services = await getServices();
    const platformService = services.serviceContainer.get<IPlatformService>(IPlatformService);
    const workspaceService = services.serviceContainer.get<IWorkspaceService>(IWorkspaceService);
    const rootUrl =
        platformService.tempDir || workspaceService.rootFolder || Uri.file('./').with({ scheme: 'vscode-test-web' });
    const uri = urlPath.joinPath(rootUrl, `${uuid()}.py`);

    await workspace.fs.writeFile(uri, Buffer.from(contents));

    disposables.push({
        dispose: () => swallowExceptions(() => workspace.fs.delete(uri))
    });
    return uri;
}

export async function submitFromPythonFile(
    interactiveWindowProvider: IInteractiveWindowProvider,
    source: string,
    disposables: IDisposable[]
) {
    const tempFile = await createTemporaryPythonFile(source, disposables);
    const untitledPythonFile = await workspace.openTextDocument(tempFile);
    await window.showTextDocument(untitledPythonFile);
    await commands.executeCommand('jupyter.runFileInteractive');
    let activeInteractiveWindow = interactiveWindowProvider.get(tempFile)!;
    await waitForInteractiveWindowToBeActive(activeInteractiveWindow, interactiveWindowProvider);
    return { activeInteractiveWindow, untitledPythonFile };
}

export async function waitForInteractiveWindowToBeActive(
    interactiveWindow: IInteractiveWindow,
    iwProvider: IInteractiveWindowProvider
): Promise<void> {
    await waitForCondition(
        () => {
            let activeWindow = iwProvider.getActiveInteractiveWindow();
            return activeWindow === interactiveWindow;
        },
        defaultNotebookTestTimeout,
        'Interactive window did not become active'
    );
}
