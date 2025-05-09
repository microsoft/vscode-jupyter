// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { ensureKernelSelectedAndStarted } from './helper';
import { IControllerRegistration, IVSCodeNotebookController } from '../../notebooks/controllers/types';
import { IKernel, IKernelProvider } from '../../kernels/types';
import assert from 'assert';

suite('ChatToolsHelper - ensureKernelIsSelectedAndRunning', () => {
    const token = new vscode.CancellationTokenSource().token;

    let kernel: { status: string; onStatusChanged: vscode.Event<void> } | undefined = undefined;

    setup(() => {
        kernel = undefined;
    });

    const selectedController = new vscode.EventEmitter<{
        notebook: vscode.NotebookDocument;
        controller: IVSCodeNotebookController;
    }>();
    const controllerRegistration = {
        onControllerSelected: selectedController.event
    } as IControllerRegistration;

    const statusChange = new vscode.EventEmitter<void>();
    const kernelProvider = {
        kernel: kernel as IKernel | undefined,
        get: (_notebook: vscode.NotebookDocument) => {
            return kernel;
        }
    } as unknown as IKernelProvider;

    test('when already running', async () => {
        const notebook = { uri: { fsPath: 'test.ipynb' } } as vscode.NotebookDocument;
        kernel = { status: 'idle', onStatusChanged: statusChange.event };
        const result = await ensureKernelSelectedAndStarted(notebook, controllerRegistration, kernelProvider, token);

        assert.strictEqual(result, kernel);
    });

    test('when not running', async () => {
        const notebook = { uri: { fsPath: 'test.ipynb' } } as vscode.NotebookDocument;
        kernel = { status: 'starting', onStatusChanged: statusChange.event };
        const promise = ensureKernelSelectedAndStarted(notebook, controllerRegistration, kernelProvider, token);

        kernel.status = 'idle';
        statusChange.fire();

        const result = await promise;

        assert.strictEqual(result, kernel);
    });

    test('kernel not selected and needs to start', async () => {
        const notebook = { uri: { fsPath: 'test.ipynb' } } as vscode.NotebookDocument;
        const promise = ensureKernelSelectedAndStarted(notebook, controllerRegistration, kernelProvider, token);

        await new Promise((resolve) => setTimeout(resolve, 10));

        kernel = { status: 'starting', onStatusChanged: statusChange.event };
        selectedController.fire({ notebook, controller: {} as IVSCodeNotebookController });

        await new Promise((resolve) => setTimeout(resolve, 10));

        kernel.status = 'idle';
        statusChange.fire();

        const result = await promise;

        assert.strictEqual(result, kernel);
    });

    test('selected kernel dies', async () => {
        const notebook = { uri: { fsPath: 'test.ipynb' } } as vscode.NotebookDocument;
        const promise = ensureKernelSelectedAndStarted(notebook, controllerRegistration, kernelProvider, token);

        await new Promise((resolve) => setTimeout(resolve, 10));

        kernel = { status: 'starting', onStatusChanged: statusChange.event };
        selectedController.fire({ notebook, controller: {} as IVSCodeNotebookController });

        await new Promise((resolve) => setTimeout(resolve, 10));

        kernel.status = 'dead';
        statusChange.fire();

        try {
            await promise;
        } catch (ex) {
            assert.strictEqual(ex.message, 'Kernel did not start successfully');
            return;
        }

        assert.fail('Expected error not thrown');
    });

    test('kernel not selected', async () => {
        const notebook = { uri: { fsPath: 'test.ipynb' } } as vscode.NotebookDocument;
        const result = await ensureKernelSelectedAndStarted(notebook, controllerRegistration, kernelProvider, token);
        assert.strictEqual(result, undefined);
    });
});
