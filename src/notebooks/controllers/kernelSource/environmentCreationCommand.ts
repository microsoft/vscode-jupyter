// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationTokenSource, commands, window } from 'vscode';
import type { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { DisposableStore } from '../../../platform/common/utils/lifecycle';
import { injectable } from 'inversify';
import { JVSC_EXTENSION_ID } from '../../../platform/common/constants';
import { PythonEnvKernelConnectionCreator } from '../pythonEnvKernelConnectionCreator.node';

@injectable()
export class EnvironmentCreationCommand implements IExtensionSyncActivationService {
    activate(): void {
        commands.registerCommand('jupyter.createPythonEnvAndSelectController', async () => {
            const editor = window.activeNotebookEditor;
            if (!editor) {
                return;
            }

            const disposables = new DisposableStore();
            const token = disposables.add(new CancellationTokenSource()).token;
            const creator = disposables.add(new PythonEnvKernelConnectionCreator(editor.notebook, token));
            const result = await creator.createPythonEnvFromKernelPicker();
            if (!result || 'action' in result) {
                return;
            }

            await commands.executeCommand('notebook.selectKernel', {
                editor,
                id: result.kernelConnection.id,
                extension: JVSC_EXTENSION_ID
            });
        });
    }
}
