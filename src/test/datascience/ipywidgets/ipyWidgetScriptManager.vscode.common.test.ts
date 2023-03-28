// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sinon from 'sinon';
import { assert } from 'chai';
import { commands, Uri } from 'vscode';
import { IDisposable, IExtensionContext, IHttpClient } from '../../../platform/common/types';
import { captureScreenShot, IExtensionTestApi, startJupyterServer } from '../../common';
import { openNotebook } from '../helpers';
import {
    closeNotebooks,
    closeNotebooksAndCleanUpAfterTests,
    createTemporaryNotebook,
    runCell,
    waitForCellExecutionToComplete,
    waitForKernelToGetAutoSelected
} from '../notebook/helper';
import { initialize } from '../../initialize';
import { JVSC_EXTENSION_ID, PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { traceInfo } from '../../../platform/logging';
import { IKernel, IKernelProvider, isLocalConnection } from '../../../kernels/types';
import { getTelemetrySafeHashedString } from '../../../platform/telemetry/helpers';
import { IFileSystem } from '../../../platform/common/platform/types';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import {
    IIPyWidgetScriptManager,
    IIPyWidgetScriptManagerFactory
} from '../../../notebooks/controllers/ipywidgets/types';
import { isWeb } from '../../../platform/common/utils/misc';
import { createActiveInterpreterController } from '../../../notebooks/controllers/helpers';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { IControllerRegistration } from '../../../notebooks/controllers/types';

suite('IPyWidget Script Manager @widgets', function () {
    this.timeout(120_000);
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let kernelProvider: IKernelProvider;
    let widgetScriptManagerFactory: IIPyWidgetScriptManagerFactory;
    let testWidgetNb: Uri;
    let kernel: IKernel;
    let scriptManager: IIPyWidgetScriptManager;
    let httpClient: IHttpClient;
    let fs: IFileSystem;
    let context: IExtensionContext;
    suiteSetup(async function () {
        traceInfo('Suite Setup');
        api = await initialize();
        await closeNotebooks();
        await startJupyterServer();
        sinon.restore();
        kernelProvider = api.serviceContainer.get<IKernelProvider>(IKernelProvider);
        httpClient = api.serviceContainer.get<IHttpClient>(IHttpClient);
        fs = api.serviceContainer.get<IFileSystem>(IFileSystem);
        context = api.serviceContainer.get<IExtensionContext>(IExtensionContext);
        widgetScriptManagerFactory =
            api.serviceContainer.get<IIPyWidgetScriptManagerFactory>(IIPyWidgetScriptManagerFactory);

        // Don't use same file (due to dirty handling, we might save in dirty.)
        testWidgetNb = await createTemporaryNotebook(
            [
                {
                    cell_type: 'code',
                    execution_count: null,
                    metadata: {},
                    outputs: [],
                    source: ['print(1)']
                }
            ],
            disposables
        );
        const { notebook, editor } = await openNotebook(testWidgetNb);
        if (!isWeb()) {
            // Create the controller and select it for the tests.
            const interpreterService = api.serviceContainer.get<IInterpreterService>(IInterpreterService);
            const controllerRegistration = api.serviceContainer.get<IControllerRegistration>(IControllerRegistration);
            const controller = await createActiveInterpreterController(
                notebook.notebookType as 'jupyter-notebook' | 'interactive',
                notebook.uri,
                interpreterService,
                controllerRegistration
            );
            if (controller) {
                await commands.executeCommand('notebook.selectKernel', {
                    id: controller.id,
                    extension: JVSC_EXTENSION_ID
                });
            }
        }
        await waitForKernelToGetAutoSelected(editor, PYTHON_LANGUAGE);
        const cell = notebook.cellAt(0);

        // Execute cell. It should load and render the widget
        await runCell(cell);
        await waitForCellExecutionToComplete(cell);

        kernel = kernelProvider.get(notebook)!;
        scriptManager = widgetScriptManagerFactory.getOrCreate(kernel);
        traceInfo('Suite Setup (completed)');
    });
    setup(async function () {
        traceInfo(`Starting Test ${this.currentTest?.title}`);
    });

    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this);
        }
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));
    test('Returns the right base Url', async function () {
        const baseUrl = await scriptManager.getBaseUrl!();
        console.error(baseUrl);
        assert.isOk(baseUrl, 'BaseUrl should be defined');

        if (isLocalConnection(kernel.kernelConnectionMetadata)) {
            if (!kernel.kernelConnectionMetadata.interpreter) {
                assert.fail('We should have started a Python kernel');
            } else {
                const expectedDir = Uri.joinPath(
                    context.extensionUri,
                    'temp',
                    'scripts',
                    await getTelemetrySafeHashedString(kernel.kernelConnectionMetadata.id),
                    'jupyter'
                );
                assert.strictEqual(baseUrl!.toString(), expectedDir.toString());

                // Verify the expected directory exists.
                assert.isTrue(await fs.exists(expectedDir), 'Directory does not exist');
            }
        } else {
            assert.strictEqual(baseUrl!.toString(), kernel.kernelConnectionMetadata.baseUrl);
        }
    });
    test('Upon restarting the kernel copy the nbextensions folder again', async function () {
        if (!isLocalConnection(kernel.kernelConnectionMetadata)) {
            return this.skip();
        }
        const expectedDir = Uri.joinPath(
            context.extensionUri,
            'temp',
            'scripts',
            await getTelemetrySafeHashedString(kernel.kernelConnectionMetadata.id),
            'jupyter'
        );
        const nbExtensionsFolder = Uri.joinPath(expectedDir, 'nbextensions');
        const files = (await fs.getFiles(nbExtensionsFolder)).map((item) => item.toString());

        // Assume the user installed a new widget, at this point the widgets should get copied over to the new directory.
        // As a test, delete the folder we created and restart the kernel, & then verify the folder was re-created.
        await scriptManager.getWidgetModuleMappings();
        assert.isTrue(await fs.exists(nbExtensionsFolder), `Directory '${nbExtensionsFolder}'does not exist`);

        // await del([nbExtensionsFolder]);
        const fsNode = api.serviceContainer.get<IFileSystemNode>(IFileSystemNode);
        // eslint-disable-next-line local-rules/dont-use-fspath
        await fsNode.delete(nbExtensionsFolder);
        assert.isFalse(await fs.exists(nbExtensionsFolder), `Directory '${nbExtensionsFolder}'does not exist`);

        await kernel.restart();
        await scriptManager.getWidgetModuleMappings();

        // Verify the nbextensions folder was created an all files copied
        assert.isTrue(await fs.exists(nbExtensionsFolder), `Directory '${nbExtensionsFolder}'does not exist`);
        const newFiles = (await fs.getFiles(nbExtensionsFolder)).map((item) => item.toString());
        assert.deepEqual(newFiles, files);
    });
    test('Get a list of Widgets and script paths', async () => {
        const baseUrl = await scriptManager.getBaseUrl!()!;
        const moduleMappings = await scriptManager.getWidgetModuleMappings();

        assert.isObject(moduleMappings);
        assert.isOk(
            Object.keys(moduleMappings!).length,
            'Should contain at least one Widget (on CI we have widgets installed in Python Env)'
        );
        await Promise.all(
            Object.keys(moduleMappings!).map(async (moduleName) => {
                if (moduleName === 'jupyter-widgets-controls') {
                    // Found that latest version of k3d has a reference to this, event though such a script is not defined
                    return;
                }
                // Verify the Url is valid.
                const uri = moduleMappings![moduleName];
                assert.isOk(uri, `Script Uri not defined for widget ${moduleName}`);
                if (!uri) {
                    return;
                }
                assert.isTrue(
                    uri.toString().startsWith(baseUrl!.toString()),
                    `Script uri ${uri.toString()} does not start with base url ${baseUrl!.toString()}`
                );
                if (isLocalConnection(kernel.kernelConnectionMetadata)) {
                    // Since we're on the local machine, such a file should exist on disc.
                    const file = `${uri.fsPath}.js`;
                    const fileExists = await fs.exists(Uri.file(file));
                    assert.isTrue(fileExists, `File '${file}' does not exist on disc`);
                } else {
                    // Verify this is a valid Uri.
                    const file = `${uri.toString()}.js`;
                    const result = await httpClient.downloadFile(file);
                    assert.isTrue(result.ok, `Uri '${file}' does not seem to be valid`);
                }
            })
        );
    });
    test('Should not contain any modules that we already bundle with our ipywidgets bundle', async () => {
        const moduleMappings = await scriptManager.getWidgetModuleMappings();
        assert.isObject(moduleMappings);
        ['jupyter-js-widgets', '@jupyter-widgets/base', '@jupyter-widgets/controls', '@jupyter-widgets/output'].forEach(
            (moduleName) => {
                assert.isFalse(moduleName in moduleMappings!, `Module ${moduleName} should not exist in the mapping`);
            }
        );
    });
});
