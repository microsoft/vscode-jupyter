// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */
import * as sinon from 'sinon';
import * as fakeTimers from '@sinonjs/fake-timers';
import { IDisposable } from '../platform/common/types';
import { disposeAllDisposables } from '../platform/common/helpers';
import { IApplicationShell } from '../platform/common/application/types';
import {
    IKernel,
    IKernelSession,
    IKernelProvider,
    INotebookKernelExecution,
    RemoteKernelSpecConnectionMetadata
} from './types';
import { anything, deepEqual, instance, mock, verify, when } from 'ts-mockito';
import {
    Disposable,
    EventEmitter,
    NotebookCell,
    NotebookCellExecutionState,
    NotebookCellExecutionStateChangeEvent,
    NotebookDocument,
    TextDocument,
    Uri
} from 'vscode';
import { Signal } from '@lumino/signaling';
import type { Kernel } from '@jupyterlab/services';
import { KernelAutoReconnectMonitor } from './kernelAutoReConnectMonitor';
import { CellExecutionCreator, NotebookCellExecutionWrapper } from './execution/cellExecutionCreator';
import { mockedVSCodeNamespaces } from '../test/vscode-mock';
import { JupyterNotebookView } from '../platform/common/constants';
import { IJupyterServerUriEntry, IJupyterServerUriStorage, IJupyterUriProviderRegistration } from './jupyter/types';
import { noop } from '../test/core';

suite('Kernel ReConnect Progress Message', () => {
    const disposables: IDisposable[] = [];
    let monitor: KernelAutoReconnectMonitor;
    let appShell: IApplicationShell;
    let kernelProvider: IKernelProvider;
    let jupyterServerUriStorage: IJupyterServerUriStorage;
    let jupyterUriProviderRegistration: IJupyterUriProviderRegistration;
    let onDidStartKernel: EventEmitter<IKernel>;
    let onDidDisposeKernel: EventEmitter<IKernel>;
    let onDidRestartKernel: EventEmitter<IKernel>;
    let kernelExecution: INotebookKernelExecution;
    let clock: fakeTimers.InstalledClock;
    setup(() => {
        onDidStartKernel = new EventEmitter<IKernel>();
        onDidDisposeKernel = new EventEmitter<IKernel>();
        onDidRestartKernel = new EventEmitter<IKernel>();

        disposables.push(...[onDidStartKernel, onDidDisposeKernel, onDidRestartKernel]);
        appShell = mock<IApplicationShell>();
        when(appShell.withProgress(anything(), anything())).thenResolve();
        kernelProvider = mock<IKernelProvider>();
        kernelExecution = mock<INotebookKernelExecution>();
        when(kernelProvider.onDidStartKernel).thenReturn(onDidStartKernel.event);
        when(kernelProvider.onDidDisposeKernel).thenReturn(onDidDisposeKernel.event);
        when(kernelProvider.onDidRestartKernel).thenReturn(onDidRestartKernel.event);
        when(kernelProvider.getKernelExecution(anything())).thenReturn(instance(kernelExecution));
        clock = fakeTimers.install();
        jupyterServerUriStorage = mock<IJupyterServerUriStorage>();
        when(jupyterServerUriStorage.getAll()).thenResolve([]);
        jupyterUriProviderRegistration = mock<IJupyterUriProviderRegistration>();

        disposables.push(new Disposable(() => clock.uninstall()));
        monitor = new KernelAutoReconnectMonitor(
            instance(appShell),
            disposables,
            instance(kernelProvider),
            instance(jupyterServerUriStorage),
            instance(jupyterUriProviderRegistration)
        );
        monitor.activate();
    });
    teardown(() => disposeAllDisposables(disposables));
    function createKernel() {
        const kernel = mock<IKernel>();
        const onRestarted = new EventEmitter<void>();
        const onPreExecute = new EventEmitter<NotebookCell>();
        disposables.push(onPreExecute);
        disposables.push(onRestarted);
        const session = mock<IKernelSession>();
        const kernelConnection = mock<Kernel.IKernelConnection>();
        const kernelConnectionStatusSignal = new Signal<Kernel.IKernelConnection, Kernel.ConnectionStatus>(
            instance(kernelConnection)
        );
        const connectionMetadata = RemoteKernelSpecConnectionMetadata.create({
            baseUrl: '<baseUrl>',
            id: '1234',
            kernelSpec: { name: 'python', display_name: 'Python', argv: [], executable: '' },
            serverProviderHandle: { handle: '1', id: '1', extensionId: '' }
        });
        when(kernelConnection.connectionStatusChanged).thenReturn(kernelConnectionStatusSignal);
        when(kernel.session).thenReturn(instance(session));
        when(kernel.resourceUri).thenReturn(Uri.file('test.ipynb'));
        when(session.kernel).thenReturn(instance(kernelConnection));
        when(kernel.kernelConnectionMetadata).thenReturn(connectionMetadata);
        when(kernelExecution.onPreExecute).thenReturn(onPreExecute.event);
        when(kernel.onRestarted).thenReturn(onRestarted.event);
        when(kernel.dispose()).thenResolve();
        let onWillRestart: (e: 'willRestart') => Promise<void> = () => Promise.resolve();
        instance(kernel).addHook = (hook, cb: any) => {
            if (hook === 'willRestart') {
                onWillRestart = cb;
            }
            return {
                dispose: noop
            };
        };
        return { kernel, onRestarted, kernelConnectionStatusSignal, onWillRestart: () => onWillRestart('willRestart') };
    }
    test('Display message when kernel is re-connecting', async () => {
        const kernel = createKernel();

        onDidStartKernel.fire(instance(kernel.kernel));

        // Send the kernel into connecting state & then disconnected.
        kernel.kernelConnectionStatusSignal.emit('connecting');
        kernel.kernelConnectionStatusSignal.emit('disconnected');
        await clock.runAllAsync();

        verify(appShell.withProgress(anything(), anything())).once();
    });
    test('Do not display a message if kernel is restarting', async () => {
        const kernel = createKernel();

        onDidStartKernel.fire(instance(kernel.kernel));

        // Send the kernel into connecting state & then disconnected.
        await kernel.onWillRestart();
        kernel.kernelConnectionStatusSignal.emit('connecting');
        kernel.kernelConnectionStatusSignal.emit('disconnected');
        onDidRestartKernel.fire(instance(kernel.kernel));

        await clock.runAllAsync();

        verify(appShell.withProgress(anything(), anything())).never();
    });
});

suite('Kernel ReConnect Failed Monitor', () => {
    const disposables: IDisposable[] = [];
    let monitor: KernelAutoReconnectMonitor;
    let appShell: IApplicationShell;
    let kernelProvider: IKernelProvider;
    let jupyterServerUriStorage: IJupyterServerUriStorage;
    let jupyterUriProviderRegistration: IJupyterUriProviderRegistration;
    let onDidStartKernel: EventEmitter<IKernel>;
    let onDidDisposeKernel: EventEmitter<IKernel>;
    let onDidRestartKernel: EventEmitter<IKernel>;
    let clock: fakeTimers.InstalledClock;
    let cellExecution: NotebookCellExecutionWrapper;
    let onDidChangeNotebookCellExecutionState: EventEmitter<NotebookCellExecutionStateChangeEvent>;
    let kernelExecution: INotebookKernelExecution;
    setup(() => {
        onDidStartKernel = new EventEmitter<IKernel>();
        onDidDisposeKernel = new EventEmitter<IKernel>();
        onDidRestartKernel = new EventEmitter<IKernel>();

        disposables.push(...[onDidStartKernel, onDidDisposeKernel, onDidRestartKernel]);
        appShell = mock<IApplicationShell>();
        when(appShell.showErrorMessage(anything())).thenResolve();
        kernelProvider = mock<IKernelProvider>();
        kernelExecution = mock<INotebookKernelExecution>();
        when(kernelProvider.onDidStartKernel).thenReturn(onDidStartKernel.event);
        when(kernelProvider.onDidDisposeKernel).thenReturn(onDidDisposeKernel.event);
        when(kernelProvider.onDidRestartKernel).thenReturn(onDidRestartKernel.event);
        when(kernelProvider.getKernelExecution(anything())).thenReturn(instance(kernelExecution));
        jupyterServerUriStorage = mock<IJupyterServerUriStorage>();
        when(jupyterServerUriStorage.getAll()).thenResolve([]);
        jupyterUriProviderRegistration = mock<IJupyterUriProviderRegistration>();
        monitor = new KernelAutoReconnectMonitor(
            instance(appShell),
            disposables,
            instance(kernelProvider),
            instance(jupyterServerUriStorage),
            instance(jupyterUriProviderRegistration)
        );
        clock = fakeTimers.install();

        cellExecution = mock<NotebookCellExecutionWrapper>();
        when(cellExecution.started).thenReturn(true);
        when(cellExecution.appendOutput(anything())).thenResolve();
        const stub = sinon.stub(CellExecutionCreator, 'getOrCreate').callsFake(() => instance(cellExecution));
        disposables.push(new Disposable(() => stub.restore()));
        disposables.push(new Disposable(() => clock.uninstall()));
        onDidChangeNotebookCellExecutionState = new EventEmitter<NotebookCellExecutionStateChangeEvent>();
        disposables.push(onDidChangeNotebookCellExecutionState);
        when(mockedVSCodeNamespaces.notebooks.onDidChangeNotebookCellExecutionState).thenReturn(
            onDidChangeNotebookCellExecutionState.event
        );
        monitor.activate();
    });
    teardown(() => disposeAllDisposables(disposables));
    function createKernel(serverProviderHandle = { handle: '1234', id: '1234', extensionId: '' }) {
        const kernel = mock<IKernel>();
        const onPreExecute = new EventEmitter<NotebookCell>();
        const onRestarted = new EventEmitter<void>();
        disposables.push(onPreExecute);
        disposables.push(onRestarted);
        const session = mock<IKernelSession>();
        const kernelConnection = mock<Kernel.IKernelConnection>();
        const kernelConnectionStatusSignal = new Signal<Kernel.IKernelConnection, Kernel.ConnectionStatus>(
            instance(kernelConnection)
        );
        const connectionMetadata = RemoteKernelSpecConnectionMetadata.create({
            baseUrl: '<baseUrl>',
            id: '1234',
            kernelSpec: { name: 'python', display_name: 'Python', argv: [], executable: '' },
            serverProviderHandle
        });
        when(kernelConnection.connectionStatusChanged).thenReturn(kernelConnectionStatusSignal);
        when(kernel.disposed).thenReturn(false);
        when(kernel.disposing).thenReturn(false);
        when(kernel.session).thenReturn(instance(session));
        when(kernel.resourceUri).thenReturn(Uri.file('test.ipynb'));
        when(session.kernel).thenReturn(instance(kernelConnection));
        when(kernel.kernelConnectionMetadata).thenReturn(connectionMetadata);
        when(kernelExecution.onPreExecute).thenReturn(onPreExecute.event);
        when(kernel.onRestarted).thenReturn(onRestarted.event);
        when(kernel.dispose()).thenResolve();

        return { kernel, onPreExecute, onRestarted, kernelConnectionStatusSignal };
    }
    function createNotebook() {
        const nb = mock<NotebookDocument>();
        when(nb.uri).thenReturn(Uri.file('test.ipynb'));
        when(nb.isClosed).thenReturn(false);
        when(nb.notebookType).thenReturn(JupyterNotebookView);
        return nb;
    }
    function createCell(nb: NotebookDocument) {
        const cell = mock<NotebookCell>();
        when(cell.notebook).thenReturn(nb);
        const doc = mock<TextDocument>();
        when(cell.document).thenReturn(instance(doc));
        when(doc.isClosed).thenReturn(false);
        return cell;
    }
    test('Display message when kernel is disconnected (without any pending cells)', async () => {
        const kernel = createKernel();

        onDidStartKernel.fire(instance(kernel.kernel));

        // Send the kernel into connecting state & then disconnected.
        kernel.kernelConnectionStatusSignal.emit('connecting');
        kernel.kernelConnectionStatusSignal.emit('disconnected');
        await clock.runAllAsync();

        verify(appShell.showErrorMessage(anything())).once();
        verify(cellExecution.appendOutput(anything())).never();
    });
    test('Do not display a message if kernel was restarted', async () => {
        const kernel = createKernel();

        onDidStartKernel.fire(instance(kernel.kernel));

        // Send the kernel into connecting state & then disconnected.
        kernel.kernelConnectionStatusSignal.emit('connecting');
        onDidRestartKernel.fire(instance(kernel.kernel));
        kernel.kernelConnectionStatusSignal.emit('disconnected');
        await clock.runAllAsync();

        verify(appShell.showErrorMessage(anything())).never();
        verify(cellExecution.appendOutput(anything())).never();
    });
    test('Do not display a message if kernel is disposed', async () => {
        const kernel = createKernel();

        onDidStartKernel.fire(instance(kernel.kernel));

        // Send the kernel into connecting state & then disconnected.
        kernel.kernelConnectionStatusSignal.emit('connecting');
        when(kernel.kernel.disposed).thenReturn(true);
        kernel.kernelConnectionStatusSignal.emit('disconnected');
        await clock.runAllAsync();

        verify(appShell.showErrorMessage(anything())).never();
        verify(cellExecution.appendOutput(anything())).never();
    });
    test('Display message when kernel is disconnected with a pending cells)', async () => {
        const kernel = createKernel();

        const nb = createNotebook();
        const cell = createCell(instance(nb));
        when(kernelProvider.get(instance(nb))).thenReturn(instance(kernel.kernel));
        onDidStartKernel.fire(instance(kernel.kernel));
        kernel.onPreExecute.fire(instance(cell));

        // Send the kernel into connecting state & then disconnected.
        kernel.kernelConnectionStatusSignal.emit('connecting');
        kernel.kernelConnectionStatusSignal.emit('disconnected');
        await clock.runAllAsync();

        verify(appShell.showErrorMessage(anything())).once();
        verify(cellExecution.appendOutput(anything())).once();
    });
    test('Do not display a message in the cell if the cell completed execution', async () => {
        const kernel = createKernel();

        const nb = createNotebook();
        const cell = createCell(instance(nb));
        when(kernelProvider.get(instance(nb))).thenReturn(instance(kernel.kernel));
        onDidStartKernel.fire(instance(kernel.kernel));
        kernel.onPreExecute.fire(instance(cell));

        // Send the kernel into connecting state & then disconnected.
        kernel.kernelConnectionStatusSignal.emit('connecting');

        // Mark the cell as completed.
        onDidChangeNotebookCellExecutionState.fire({ cell: instance(cell), state: NotebookCellExecutionState.Idle });
        kernel.kernelConnectionStatusSignal.emit('disconnected');
        await clock.runAllAsync();

        verify(appShell.showErrorMessage(anything())).once();
        verify(cellExecution.appendOutput(anything())).never();
    });

    test('Handle contributed server disconnect (server contributed by uri provider)', async () => {
        const server: IJupyterServerUriEntry = {
            time: 1234,
            provider: {
                handle: '1',
                id: '1',
                extensionId: ''
            }
        };
        const kernel = createKernel(server.provider);
        when(jupyterServerUriStorage.getAll()).thenResolve([server]);
        when(jupyterServerUriStorage.get(deepEqual({ id: '1', handle: '1', extensionId: '' }))).thenResolve(server);
        when(jupyterUriProviderRegistration.getProvider(anything())).thenResolve({
            id: 'remoteUriProvider',
            extensionId: 'ms-python.python',
            getServerUri: (_handle) =>
                Promise.resolve({
                    baseUrl: '<baseUrl>',
                    token: '<token>',
                    authorizationHeader: {},
                    displayName: 'Remote Uri Provider server 1'
                }),
            getHandles: () => Promise.resolve(['1'])
        });

        onDidStartKernel.fire(instance(kernel.kernel));

        // Send the kernel into connecting state & then disconnected.
        kernel.kernelConnectionStatusSignal.emit('connecting');
        kernel.kernelConnectionStatusSignal.emit('disconnected');
        await clock.runAllAsync();

        // the server is gone, the kernel is disposed so we don't show the error message
        verify(appShell.showErrorMessage(anything())).never();
        verify(cellExecution.appendOutput(anything())).never();
    });
});
