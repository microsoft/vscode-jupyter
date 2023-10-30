// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import * as path from '../../../platform/vscode-path/path';
import * as vscode from 'vscode';
import {
    IConfigurationService,
    IDisposable,
    IExperimentService,
    IJupyterSettings,
    IVariableTooltipFields,
    ReadWrite
} from '../../../platform/common/types';
import { IExtensionTestApi, openFile, sleep } from '../../common.node';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../constants.node';
import { initialize } from '../../initialize.node';
import { HoverProvider } from '../../../interactive-window/editor-integration/hoverProvider';
import { dispose } from '../../../platform/common/helpers';
import { IKernelProvider } from '../../../kernels/types';
import { IVSCodeNotebook } from '../../../platform/common/application/types';
import { IInteractiveWindowProvider } from '../../../interactive-window/types';
import { IJupyterVariables } from '../../../kernels/variables/types';
import { Identifiers } from '../../../platform/common/constants';

suite('Hover provider @lsp', async () => {
    const file = path.join(
        EXTENSION_ROOT_DIR_FOR_TESTS,
        'src',
        'test',
        'datascience',
        'editor-integration',
        'tooltips.py'
    );
    let dsSettings: ReadWrite<IJupyterSettings>;
    let api: IExtensionTestApi;
    let oldSetting: IVariableTooltipFields;
    let sandbox: sinon.SinonSandbox;
    let disposables: IDisposable[] = [];
    suiteSetup(async function () {
        return this.skip();
        api = await initialize();
        const configService = api.serviceManager.get<IConfigurationService>(IConfigurationService);
        dsSettings = configService.getSettings();
        oldSetting = JSON.parse(JSON.stringify(dsSettings.variableTooltipFields));
        dsSettings.variableTooltipFields = {
            python: {
                Tensor: ['shape', 'dtype', 'device']
            }
        };
        sandbox = sinon.createSandbox();
        const experimentService = api.serviceManager.get<IExperimentService>(IExperimentService);
        sandbox.stub(experimentService, 'inExperiment').resolves(true);
    });
    suiteTeardown(async () => {
        if (sandbox) {
            sandbox.restore();
        }
        if (dsSettings) {
            dsSettings.variableTooltipFields = oldSetting;
        }
    });
    teardown(() => dispose(disposables));
    test('Tensor tooltips', async () => {
        // Open a Python file
        const textDocument = await openFile(file);

        // Wait for code lenses to get detected.
        await sleep(1_000);

        // Execute its contents in the interactive window
        await vscode.commands.executeCommand<void>('jupyter.runallcells', textDocument.uri);

        // Request a hover on the line containing a tensor variable declaration
        const hoverProvider = new HoverProvider(
            api.serviceContainer.get<IJupyterVariables>(IJupyterVariables, Identifiers.KERNEL_VARIABLES),
            api.serviceContainer.get<IInteractiveWindowProvider>(IInteractiveWindowProvider),
            api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook),
            disposables,
            api.serviceContainer.get<IKernelProvider>(IKernelProvider)
        );
        hoverProvider.activate();
        const position = new vscode.Position(11, 1);
        const cancelTokenSource = new vscode.CancellationTokenSource();
        const result = await hoverProvider.provideHover(textDocument, position, cancelTokenSource.token);

        // Verify contents of returned hover
        assert.ok(result?.contents && result.contents.length > 0, 'No results returned from hover provider request');
        const contents = result?.contents[0] as vscode.MarkdownString;
        assert.ok(
            contents.value ===
                "```\nshape: torch.Size([64, 1000])\ndtype: torch.float32\ndevice: device(type='cpu')\n```",
            `Unexpected hover provider result: ${contents.value}`
        );
    });
});
