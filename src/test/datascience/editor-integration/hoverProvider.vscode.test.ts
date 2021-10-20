import { assert } from 'chai';
import { cloneDeep } from 'lodash';
import * as sinon from 'sinon';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    IConfigurationService,
    IDisposable,
    IExperimentService,
    IJupyterSettings,
    IVariableTooltipFields,
    ReadWrite
} from '../../../client/common/types';
import { IInteractiveWindowProvider, IJupyterVariables } from '../../../client/datascience/types';
import { IExtensionTestApi, openFile, sleep } from '../../common';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../constants';
import { initialize } from '../../initialize';
import { HoverProvider } from '../../../client/datascience/editor-integration/hoverProvider';
import { Identifiers } from '../../../client/datascience/constants';
import { disposeAllDisposables } from '../../../client/common/helpers';
import { IKernelProvider } from '../../../client/datascience/jupyter/kernels/types';
import { IVSCodeNotebook } from '../../../client/common/application/types';
import { IFileSystem } from '../../../client/common/platform/types';

suite('Hover provider', async () => {
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
        oldSetting = cloneDeep(dsSettings.variableTooltipFields);
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
    teardown(() => disposeAllDisposables(disposables));
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
            api.serviceContainer.get<IFileSystem>(IFileSystem),
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
