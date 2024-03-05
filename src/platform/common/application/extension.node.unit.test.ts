// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { anything, when } from 'ts-mockito';
import { Disposable, EventEmitter, Uri } from 'vscode';
import { mockedVSCodeNamespaces, resetVSCodeMocks } from '../../../test/vscode-mock';
import { DisposableStore } from '../utils/lifecycle';
import { Extensions } from './extensions.node';
import { EOL } from 'os';

const stack1 = [
    'Error: ',
    '    at Extensions.determineExtensionFromCallStack (/Users/username/Development/vsc/vscode-jupyter/src/platform/common/application/extensions.node.ts:18:26)',
    '    at JupyterKernelServiceFactory.getService (/Users/username/Development/vsc/vscode-jupyter/src/standalone/api/unstable/kernelApi.ts:43:38)',
    '    at getKernelService (/Users/username/Development/vsc/vscode-jupyter/src/standalone/api/unstable/index.ts:92:33)',
    '    at Object.getKernelService (/Users/username/Development/vsc/vscode-jupyter/src/standalone/api/index.ts:43:33)',
    '    at activateFeature (/Users/username/.vscode-insiders/extensions/ms-toolsai.vscode-jupyter-powertoys-0.1.0/out/main.js:13466:56)',
    '    at activate (/Users/username/.vscode-insiders/extensions/ms-toolsai.vscode-jupyter-powertoys-0.1.0/out/main.js:13479:9)',
    '    at activate (/Users/username/.vscode-insiders/extensions/ms-toolsai.vscode-jupyter-powertoys-0.1.0/out/main.js:14160:5)',
    '    at u.n (/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/out/vs/workbench/api/node/extensionHostProcess.js:140:6255)',
    '    at u.m (/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/out/vs/workbench/api/node/extensionHostProcess.js:140:6218)',
    '    at u.l (/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/out/vs/workbench/api/node/extensionHostProcess.js:140:5675)'
];
const stack2 = [
    'Error:',
    '    at kg.determineExtensionFromCallStack (/storage/username/.vscode-insiders/extensions/ms-toolsai.jupyter-2024.3.0/dist/extension.node.js:203:3695)',
    '    at F9 (/storage/username/.vscode-insiders/extensions/ms-toolsai.jupyter-2024.3.0/dist/extension.node.js:198:24742)',
    '    at Object.getKernelService (/storage/username/.vscode-insiders/extensions/ms-toolsai.jupyter-2024.3.0/dist/extension.node.js:198:26312)',
    '    at activateFeature (/storage/username/.vscode-insiders/extensions/ms-toolsai.vscode-jupyter-powertoys-0.1.0/out/main.js:335:56)',
    '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
    '    at async activate (/storage/username/.vscode-insiders/extensions/ms-toolsai.vscode-jupyter-powertoys-0.1.0/out/main.js:343:9)',
    '    at async activate (/storage/username/.vscode-insiders/extensions/ms-toolsai.vscode-jupyter-powertoys-0.1.0/out/main.js:13995:5)',
    '    at async u.n (/storage/username/.vscode-insiders/cli/servers/Insiders-bb171489789c9a49e985a4a2c8694138d70d42c1/server/out/vs/workbench/api/node/extensionHostProcess.js:140:6255)',
    '    at async u.m (/storage/username/.vscode-insiders/cli/servers/Insiders-bb171489789c9a49e985a4a2c8694138d70d42c1/server/out/vs/workbench/api/node/extensionHostProcess.js:140:6218)',
    '    at async u.l (/storage/username/.vscode-insiders/cli/servers/Insiders-bb171489789c9a49e985a4a2c8694138d70d42c1/server/out/vs/workbench/api/node/extensionHostProcess.js:140:5675)'
];
const extensions1 = [
    {
        id: 'vscode.bat',
        packageJSON: { displayName: 'vscode.bat' },
        extensionUri: Uri.file('/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/extensions/bat')
    },
    {
        id: 'donjayamanne.kusto',
        packageJSON: { displayName: 'donjayamanne.kusto' },
        extensionUri: Uri.file('/Users/username/.vscode-insiders/extensions/donjayamanne.kusto-0.4.4')
    },
    {
        id: 'ms-python.python',
        packageJSON: { displayName: 'ms-python.python' },
        extensionUri: Uri.file('/Users/username/.vscode-insiders/extensions/ms-python.python-2024.3.10640539')
    },
    {
        id: 'ms-toolsai.vscode-jupyter-powertoys',
        packageJSON: { displayName: 'ms-toolsai.vscode-jupyter-powertoys' },
        extensionUri: Uri.file('/Users/username/.vscode-insiders/extensions/ms-toolsai.vscode-jupyter-powertoys-0.1.0')
    },
    {
        id: 'ms-toolsai.jupyter',
        packageJSON: { displayName: 'ms-toolsai.jupyter' },
        extensionUri: Uri.file('/Users/username/Development/vsc/vscode-jupyter')
    }
];
const extensions2 = [
    {
        id: 'vscode.bat',
        packageJSON: { displayName: 'vscode.bat', version: '1.0.0' },
        extensionUri: Uri.file('/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/extensions/bat')
    },
    {
        id: 'donjayamanne.kusto',
        packageJSON: { displayName: 'donjayamanne.kusto', version: '0.4.4' },
        extensionUri: Uri.file('/Users/username/.vscode-insiders/extensions/donjayamanne.kusto-0.4.4')
    },
    {
        id: 'ms-python.python',
        packageJSON: { displayName: 'ms-python.python', version: '2024.3.10640539' },
        extensionUri: Uri.file('/storage/username/.vscode-server-insiders/extensions/ms-python.python-2024.3.10640539')
    },
    {
        id: 'ms-toolsai.vscode-jupyter-powertoys',
        packageJSON: { displayName: 'ms-toolsai.vscode-jupyter-powertoys', version: '0.1.0' },
        extensionUri: Uri.file(
            '/storage/username/.vscode-server-insiders/extensions/ms-toolsai.vscode-jupyter-powertoys-0.1.0'
        )
    },
    {
        id: 'ms-toolsai.jupyter',
        packageJSON: { displayName: 'ms-toolsai.jupyter', version: '2024.3.0' },
        extensionUri: Uri.file('/storage/username/.vscode-server-insiders/extensions/ms-toolsai.jupyter-2024.3.0')
    }
];

suite(`Interpreter Service`, () => {
    const disposables = new DisposableStore();
    setup(() => {
        when(mockedVSCodeNamespaces.extensions.onDidChange).thenReturn(disposables.add(new EventEmitter<void>()).event);
        disposables.add(new Disposable(() => resetVSCodeMocks()));
    });
    teardown(() => disposables.clear());
    test('Identify from callstack', () => {
        when(mockedVSCodeNamespaces.extensions.all).thenReturn(extensions1 as any);
        when(mockedVSCodeNamespaces.extensions.getExtension(anything())).thenCall(function (id: string) {
            return extensions1.find((e) => e.id === id);
        });
        const { displayName, extensionId } = new Extensions([]).determineExtensionFromCallStack(stack1.join(EOL));
        assert.strictEqual(extensionId, 'ms-toolsai.vscode-jupyter-powertoys');
        assert.strictEqual(displayName, 'ms-toolsai.vscode-jupyter-powertoys');
    });
    test('Identify from callstack on remote server', () => {
        when(mockedVSCodeNamespaces.extensions.all).thenReturn(extensions2 as any);
        when(mockedVSCodeNamespaces.extensions.getExtension(anything())).thenCall(function (id: string) {
            return extensions2.find((e) => e.id === id);
        });
        const { displayName, extensionId } = new Extensions([]).determineExtensionFromCallStack(stack2.join(EOL));
        assert.strictEqual(extensionId, 'ms-toolsai.vscode-jupyter-powertoys');
        assert.strictEqual(displayName, 'ms-toolsai.vscode-jupyter-powertoys');
    });
});
