// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { EventEmitter } from 'vscode';
import { instance, mock, when } from 'ts-mockito';
import { KernelStatusProvider } from './kernelStatusProvider';
import { IKernel, IKernelProvider, LocalKernelSpecConnectionMetadata } from './types';
import { IDisposable } from '../platform/common/types';
import { dispose } from '../platform/common/utils/lifecycle';
import { KernelProgressReporter } from '../platform/progress/kernelProgressReporter';

suite('KernelStatusProvider', () => {
    let kernelProvider: IKernelProvider;
    let provider: KernelStatusProvider;
    let onDidCreateKernel: EventEmitter<IKernel>;
    let onDidDisposeKernel: EventEmitter<IKernel>;
    let disposables: IDisposable[] = [];
    let reporters: { disposed: boolean }[] = [];
    let oldCreateProgressReporter: typeof KernelProgressReporter.createProgressReporter;
    const connectionMetadata = LocalKernelSpecConnectionMetadata.create({
        id: '123',
        kernelSpec: {
            argv: [],
            display_name: 'Hello',
            name: 'hello',
            executable: 'path'
        }
    });

    function createFakeKernel() {
        const hooks = new Map<string, Array<(...args: unknown[]) => Promise<void>>>();
        const kernel = {
            resourceUri: undefined,
            kernelConnectionMetadata: connectionMetadata,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            addHook: (event: string, cb: (...args: any[]) => Promise<void>, thisArgs?: unknown) => {
                const bound = thisArgs ? cb.bind(thisArgs) : cb;
                const list = hooks.get(event) || [];
                list.push(bound);
                hooks.set(event, list);
                return { dispose: () => undefined };
            }
        } as unknown as IKernel;
        const fireHook = (event: string) => Promise.all((hooks.get(event) || []).map((h) => h()));
        return { kernel, fireHook };
    }

    setup(() => {
        onDidCreateKernel = new EventEmitter<IKernel>();
        onDidDisposeKernel = new EventEmitter<IKernel>();
        kernelProvider = mock<IKernelProvider>();
        when(kernelProvider.onDidCreateKernel).thenReturn(onDidCreateKernel.event);
        when(kernelProvider.onDidDisposeKernel).thenReturn(onDidDisposeKernel.event);

        reporters = [];
        oldCreateProgressReporter = KernelProgressReporter.createProgressReporter;
        KernelProgressReporter.createProgressReporter = () => {
            const reporter = {
                disposed: false,
                dispose() {
                    this.disposed = true;
                }
            };
            reporters.push(reporter);
            return reporter;
        };

        provider = new KernelStatusProvider(instance(kernelProvider), disposables);
        provider.activate();
    });

    teardown(() => {
        KernelProgressReporter.createProgressReporter = oldCreateProgressReporter;
        onDidCreateKernel.dispose();
        onDidDisposeKernel.dispose();
        disposables = dispose(disposables);
    });

    test('A hidden restart disposes a previously visible restart spinner instead of leaking it', async () => {
        const { kernel, fireHook } = createFakeKernel();
        onDidCreateKernel.fire(kernel);

        // A visible restart creates the progress spinner.
        await fireHook('willRestart');
        assert.strictEqual(reporters.length, 1);
        assert.isFalse(reporters[0].disposed);

        // Subsequent restarts for this kernel are hidden.
        provider.hideRestartProgress(kernel);

        // A hidden restart supersedes the visible one; the earlier spinner must be disposed (not leaked),
        // and no new visible spinner is created.
        await fireHook('willRestart');
        assert.isTrue(reporters[0].disposed);
        assert.strictEqual(reporters.length, 1);
    });

    test('A hidden restart without an existing spinner does not create a new one', async () => {
        const { kernel, fireHook } = createFakeKernel();
        onDidCreateKernel.fire(kernel);

        provider.hideRestartProgress(kernel);
        await fireHook('willRestart');

        assert.strictEqual(reporters.length, 0);
    });
});
