// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as fakeTimers from '@sinonjs/fake-timers';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { Disposable, EventEmitter, NotebookDocument } from 'vscode';
import { ContributedKernelFinderKind, IContributedKernelFinder } from '../../../kernels/internalTypes';
import { IDisposable } from '../../../platform/common/types';
import { DataScience } from '../../../platform/common/utils/localize';
import { QuickPickKernelItemProvider } from './quickPickKernelItemProvider';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { KernelConnectionMetadata } from '../../../kernels/types';
import { noop } from '../../../platform/common/utils/misc';
import { PythonEnvironmentFilter } from '../../../platform/interpreter/filter/filterService';
import { JupyterConnection } from '../../../kernels/jupyter/connection/jupyterConnection';

suite('Quick Pick Kernel Item Provider', () => {
    [
        ContributedKernelFinderKind.LocalKernelSpec,
        ContributedKernelFinderKind.LocalPythonEnvironment,
        ContributedKernelFinderKind.Remote
    ].forEach((kind) => {
        suite(kind, () => {
            let provider: QuickPickKernelItemProvider;
            let finder: IContributedKernelFinder;
            let notebook: NotebookDocument;
            let onDidChangeKernels: EventEmitter<{ added?: any[]; removed?: any[]; updated?: any[] }>;
            let onDidChangeStatus: EventEmitter<void>;
            let jupyterConnection: JupyterConnection;
            const disposables: IDisposable[] = [];
            let clock: fakeTimers.InstalledClock;
            const pythonEnvFilter = mock<PythonEnvironmentFilter>();
            when(pythonEnvFilter.isPythonEnvironmentExcluded(anything())).thenReturn(false);
            const kernelConnection1 = instance(mock<KernelConnectionMetadata>());
            const kernelConnection2 = instance(mock<KernelConnectionMetadata>());
            const kernelConnection3 = instance(mock<KernelConnectionMetadata>());
            const kernelConnection4 = instance(mock<KernelConnectionMetadata>());
            setup(() => {
                finder = mock<IContributedKernelFinder>();
                jupyterConnection = mock(JupyterConnection);
                onDidChangeKernels = new EventEmitter<{ added: any[]; removed: any[]; updated: any[] }>();
                onDidChangeStatus = new EventEmitter<void>();
                disposables.push(onDidChangeKernels);
                disposables.push(onDidChangeStatus);
                when(finder.onDidChangeKernels).thenReturn(onDidChangeKernels.event);
                when(finder.onDidChangeStatus).thenReturn(onDidChangeStatus.event);
                when(finder.kind).thenReturn(kind);
                switch (kind) {
                    case ContributedKernelFinderKind.LocalKernelSpec:
                        when(finder.displayName).thenReturn(DataScience.localKernelSpecs);
                        break;
                    case ContributedKernelFinderKind.LocalPythonEnvironment:
                        when(finder.displayName).thenReturn(DataScience.localPythonEnvironments);
                        break;
                    case ContributedKernelFinderKind.Remote:
                        when(finder.displayName).thenReturn('Remote Server');
                        break;
                }
                when(finder.displayName).thenReturn('x');
                when(finder.kernels).thenReturn([]);
                when(finder.refresh()).thenResolve();
                when(finder.status).thenReturn('idle');
                (instance(finder) as any).then = undefined;
                notebook = mock<NotebookDocument>();
                clock = fakeTimers.install();
                disposables.push(new Disposable(() => clock.uninstall()));
            });
            function createProvider() {
                provider = new QuickPickKernelItemProvider(
                    instance(notebook),
                    kind,
                    kind === ContributedKernelFinderKind.Remote ? Promise.resolve(instance(finder)) : instance(finder),
                    instance(pythonEnvFilter),
                    instance(jupyterConnection)
                );
            }
            teardown(() => disposeAllDisposables(disposables));
            test('Verify title and status', async () => {
                createProvider();

                assert.strictEqual(provider.kind, kind);
                assert.strictEqual(provider.status, 'idle');
                assert.deepEqual(provider.kernels, []);
                assert.isUndefined(provider.recommended);

                await clock.runAllAsync();

                let expectedTitle = '';
                switch (kind) {
                    case ContributedKernelFinderKind.LocalKernelSpec:
                        expectedTitle = DataScience.kernelPickerSelectLocalKernelSpecTitle;
                        break;
                    case ContributedKernelFinderKind.LocalPythonEnvironment:
                        expectedTitle = DataScience.selectPythonEnvironmentTitle;
                        break;
                    default:
                        expectedTitle = DataScience.kernelPickerSelectKernelFromRemoteTitle(
                            instance(finder).displayName
                        );
                        break;
                }
                assert.strictEqual(provider.title, expectedTitle);
            });
            test('Verify status change and kernels listing', async () => {
                when(finder.status).thenReturn('discovering');
                when(finder.kernels).thenReturn([kernelConnection1]);

                createProvider();

                await clock.runAllAsync();

                assert.deepEqual(provider.status, 'discovering');
                assert.deepEqual(provider.kernels, [kernelConnection1]);

                // Update kernels
                when(finder.kernels).thenReturn([kernelConnection1, kernelConnection2]);
                onDidChangeKernels.fire({});

                assert.deepEqual(provider.status, 'discovering');
                assert.deepEqual(provider.kernels, [kernelConnection1, kernelConnection2]);

                // Update statius
                when(finder.status).thenReturn('idle');
                when(finder.kernels).thenReturn([
                    kernelConnection1,
                    kernelConnection2,
                    kernelConnection3,
                    kernelConnection4
                ]);
                onDidChangeKernels.fire({});
                onDidChangeStatus.fire();

                assert.deepEqual(provider.status, 'idle');
                assert.deepEqual(provider.kernels, [
                    kernelConnection1,
                    kernelConnection2,
                    kernelConnection3,
                    kernelConnection4
                ]);

                // Remove items
                when(finder.status).thenReturn('discovering');
                when(finder.kernels).thenReturn([kernelConnection1, kernelConnection4]);
                onDidChangeKernels.fire({});
                onDidChangeStatus.fire();

                assert.deepEqual(provider.status, 'discovering');
                assert.deepEqual(provider.kernels, [kernelConnection1, kernelConnection4]);
            });
            test('Refresh', async () => {
                createProvider();
                provider.refresh().catch(noop);

                await clock.runAllAsync();

                verify(finder.refresh()).once();
            });
        });
    });
});
