// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { PythonExtension } from '@vscode/python-extension';
import {
    commands,
    NotebookCellData,
    NotebookCellKind,
    NotebookData,
    NotebookDocument,
    Uri,
    window,
    workspace
} from 'vscode';
import { initialize } from '../../initialize';
import { IExtensionTestApi, waitForCondition } from '../../common';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { createInterpreterKernelSpec, getKernelId } from '../../../kernels/helpers';
import { IKernel, IKernelProvider, PythonKernelConnectionMetadata } from '../../../kernels/types';
import { IControllerRegistration, IVSCodeNotebookController } from '../../../notebooks/controllers/types';
import { JupyterNotebookView, JVSC_EXTENSION_ID } from '../../../platform/common/constants';
import { DisplayOptions } from '../../../kernels/displayOptions';
import { createDeferred, raceTimeoutError, sleep } from '../../../platform/common/utils/async';
import { noop } from '../../../platform/common/utils/misc';

// eslint-disable-next-line local-rules/dont-use-process
(process.platform === 'win32' && process.env.VSC_JUPYTER_TEST_RAW_STARTUP_RECOVERY === '1' ? suite : suite.skip)(
    'Raw startup recovery isolated host @startupRecoveryHost',
    function () {
        this.timeout(90000);
        let api: IExtensionTestApi;
        let provider: IKernelProvider;
        let registration: IControllerRegistration;
        let metadata: PythonKernelConnectionMetadata;
        let controller: IVSCodeNotebookController;
        const owned = new Set<IKernel>();

        suiteSetup(async () => {
            // eslint-disable-next-line local-rules/dont-use-process
            const python = process.env.VSC_JUPYTER_TEST_PYTHON;
            if (!python) {
                throw new Error('Isolated host requires VSC_JUPYTER_TEST_PYTHON');
            }
            await PythonExtension.api();
            api = await initialize();
            provider = api.serviceContainer.get<IKernelProvider>(IKernelProvider);
            registration = api.serviceContainer.get<IControllerRegistration>(IControllerRegistration);
            const interpreters = api.serviceContainer.get<IInterpreterService>(IInterpreterService);
            const interpreter = await interpreters.getInterpreterDetails(Uri.file(python));
            if (!interpreter) {
                throw new Error('Private test interpreter was not resolved');
            }
            const spec = await createInterpreterKernelSpec(interpreter);
            metadata = PythonKernelConnectionMetadata.create({
                id: getKernelId(spec, interpreter),
                interpreter,
                kernelSpec: spec
            });
            const registered = registration.addOrUpdate(metadata, [JupyterNotebookView]);
            if (!registered[0]) {
                throw new Error('Private Python notebook controller was not registered');
            }
            controller = registered[0];
        });

        suiteTeardown(async () => {
            await Promise.all([...owned].map((kernel) => kernel.dispose()));
            await commands.executeCommand('workbench.action.closeAllEditors');
        });

        async function notebook() {
            return workspace.openNotebookDocument(
                JupyterNotebookView,
                new NotebookData([
                    new NotebookCellData(NotebookCellKind.Code, 'print("startup-recovery-host-proof")', 'python')
                ])
            );
        }

        async function select(document: NotebookDocument) {
            await window.showNotebookDocument(document);
            await commands.executeCommand('notebook.selectKernel', { id: controller.id, extension: JVSC_EXTENSION_ID });
            await waitForCondition(
                () => registration.getSelected(document)?.id === controller.id,
                30000,
                'Private test controller was not selected'
            );
            const kernel = provider.getOrCreate(document, {
                metadata,
                controller: controller.controller,
                resourceUri: document.uri
            });
            owned.add(kernel);
            return kernel;
        }

        async function runCell(kernel: IKernel, document: NotebookDocument) {
            await provider.getKernelExecution(kernel).executeCell(document.cellAt(0));
            await waitForCondition(
                () => document.cellAt(0).executionSummary?.success === true,
                20000,
                'Real notebook cell did not complete successfully'
            );
            const text = document
                .cellAt(0)
                .outputs.flatMap((output) => output.items)
                .map((item) => Buffer.from(item.data).toString('utf8'))
                .join('');
            assert.include(text, 'startup-recovery-host-proof');
        }

        test('two selected notebooks start in auto style, execute first cells and restart', async () => {
            const first = await notebook();
            const second = await notebook();
            const kernels = [await select(first), await select(second)];
            await Promise.all(kernels.map((kernel) => kernel.start(new DisplayOptions(true))));
            assert.isTrue(kernels.every((kernel) => kernel.status === 'idle' && !!kernel.session));
            await Promise.all([runCell(kernels[0], first), runCell(kernels[1], second)]);
            await kernels[0].restart();
            await runCell(kernels[0], first);
            assert.strictEqual(kernels[0].status, 'idle');
        });

        test('review regression: cold raw restart initializes its first transport once', async () => {
            const document = await notebook();
            const kernel = provider.getOrCreate(document, {
                metadata,
                controller: controller.controller,
                resourceUri: document.uri
            });
            owned.add(kernel);
            let initializations = 0;
            let started = 0;
            let restarted = 0;
            const hook = kernel.addHook('didStart', async () => {
                initializations += 1;
            });
            const startedListener = kernel.onStarted(() => (started += 1));
            const restartedListener = kernel.onRestarted(() => (restarted += 1));
            try {
                assert.isUndefined(kernel.session);
                await raceTimeoutError(
                    30000,
                    new Error('Cold raw restart did not initialize the real transport'),
                    kernel.restart()
                );
                assert.strictEqual(initializations, 1);
                assert.strictEqual(started, 1);
                assert.strictEqual(restarted, 1);
                assert.strictEqual(kernel.status, 'idle');
                const selectedKernel = await select(document);
                assert.strictEqual(selectedKernel, kernel);
                await runCell(selectedKernel, document);
            } finally {
                hook.dispose();
                startedListener.dispose();
                restartedListener.dispose();
            }
        });

        test('cancelling an unpublished real session cannot publish late', async () => {
            const document = await notebook();
            const kernel = provider.getOrCreate(document, {
                metadata,
                controller: controller.controller,
                resourceUri: document.uri
            });
            owned.add(kernel);
            const entered = createDeferred<void>();
            const gate = createDeferred<void>();
            const hook = kernel.addHook('didStart', async () => {
                entered.resolve();
                await gate.promise;
            });
            let published = 0;
            const listener = kernel.onStarted(() => (published += 1));
            const starting = kernel.start(new DisplayOptions(true));
            starting.catch(noop);
            try {
                await raceTimeoutError(30000, new Error('Real startup hook was not entered'), entered.promise);
                await raceTimeoutError(
                    10000,
                    new Error('Real startup cancellation leaked its session'),
                    kernel.dispose()
                );
                const error = await starting.catch((error: unknown) => error);
                assert.instanceOf(error, Error);
                gate.resolve();
                await sleep(50);
                assert.strictEqual(published, 0);
                assert.isUndefined(kernel.session);
                assert.isTrue(kernel.disposed);
            } finally {
                gate.resolve();
                hook.dispose();
                listener.dispose();
            }
        });
    }
);
