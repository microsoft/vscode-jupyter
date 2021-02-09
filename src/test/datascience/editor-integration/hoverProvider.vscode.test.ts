import { assert } from 'chai';
import { cloneDeep } from 'lodash';
import * as path from 'path';
import * as vscode from 'vscode';
import { IConfigurationService, IJupyterSettings, ReadWrite } from '../../../client/common/types';
import { IHoverProvider } from '../../../client/datascience/types';
import { IExtensionTestApi, openFile, sleep } from '../../common';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../constants';
import { initialize } from '../../initialize';

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
    let oldSetting: any;
    suiteSetup(async function () {
        if (process.env.VSC_FORCE_REAL_JUPYTER === undefined) {
            return this.skip();
        }
        api = await initialize();
        const configService = api.serviceManager.get<IConfigurationService>(IConfigurationService);
        dsSettings = configService.getSettings();
        oldSetting = cloneDeep(dsSettings.variableTooltipFields);
        dsSettings.variableTooltipFields = {
            python: {
                Tensor: ['shape', 'dtype', 'device']
            }
        };
    });
    suiteTeardown(async () => {
        dsSettings.variableTooltipFields = oldSetting;
    });
    test('Tensor tooltips', async () => {
        // Open a Python file
        const textDocument = await openFile(file);

        // Wait for code lenses to get detected.
        await sleep(1_000);

        // Execute its contents in the interactive window
        await vscode.commands.executeCommand<void>('jupyter.runallcells', textDocument.uri);

        // Request a hover on the line containing a tensor variable declaration
        const hoverProvider = api.serviceContainer.get<IHoverProvider>(IHoverProvider);
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
