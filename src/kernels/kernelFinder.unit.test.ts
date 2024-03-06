// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { assert } from 'chai';
import * as sinon from 'sinon';
import { instance, mock, when } from 'ts-mockito';
import { EventEmitter } from 'vscode';
import { createEventHandler, type TestEventHandler } from '../test/common';
import { KernelConnectionMetadata } from './types';
import { DisposableStore } from '../platform/common/utils/lifecycle';
import { KernelFinder } from './kernelFinder';
import type { IContributedKernelFinder } from './internalTypes';

suite('Kernel Finder', () => {
    const disposables = new DisposableStore();
    let kernelFinder: KernelFinder;
    let onDidChangeKernelFinderStatus: TestEventHandler<void>;
    setup(() => {
        kernelFinder = disposables.add(new KernelFinder([]));
        onDidChangeKernelFinderStatus = disposables.add(createEventHandler(kernelFinder, 'onDidChangeStatus'));
    });
    teardown(async () => {
        sinon.restore();
        disposables.clear();
    });
    test('Is idle', async () => {
        assert.strictEqual(kernelFinder.status, 'idle');
    });
    test('Is empty', async () => {
        assert.strictEqual(kernelFinder.kernels.length, 0);
    });
    function createFinder() {
        const finder = mock<IContributedKernelFinder<KernelConnectionMetadata>>();
        const ondDiChangeStatus = disposables.add(new EventEmitter<void>());
        when(finder.onDidChangeStatus).thenReturn(ondDiChangeStatus.event);
        const onDidChangeKernels = disposables.add(
            new EventEmitter<{
                removed?:
                    | {
                          id: string;
                      }[]
                    | undefined;
            }>()
        );
        when(finder.onDidChangeKernels).thenReturn(onDidChangeKernels.event);
        const onDidDispose = disposables.add(new EventEmitter<void>());
        when(finder.onDidDispose).thenReturn(onDidDispose.event);
        when(finder.status).thenReturn('idle');

        return { finder, ondDiChangeStatus, onDidChangeKernels, onDidDispose };
    }
    test('Registering an idle finder will not update the status', async () => {
        const { finder } = createFinder();

        disposables.add(kernelFinder.registerKernelFinder(instance(finder)));

        assert.strictEqual(onDidChangeKernelFinderStatus.count, 0);
        assert.strictEqual(kernelFinder.status, 'idle');
    });
    test('Registering a busy finder will update the status', async () => {
        const { finder } = createFinder();
        when(finder.status).thenReturn('discovering');

        disposables.add(kernelFinder.registerKernelFinder(instance(finder)));

        assert.strictEqual(onDidChangeKernelFinderStatus.count, 1);
        assert.strictEqual(kernelFinder.status, 'discovering');
    });
    test('When finder status changes, kernel finder status will also change', async () => {
        const { finder, ondDiChangeStatus } = createFinder();

        disposables.add(kernelFinder.registerKernelFinder(instance(finder)));

        assert.strictEqual(onDidChangeKernelFinderStatus.count, 0);
        assert.strictEqual(kernelFinder.status, 'idle');

        when(finder.status).thenReturn('discovering');
        ondDiChangeStatus.fire();

        assert.strictEqual(onDidChangeKernelFinderStatus.count, 1);
        assert.strictEqual(kernelFinder.status, 'discovering');
    });
    test('When finder status changes but finder registration has been disposed, kernel finder status will not change', async () => {
        const { finder, ondDiChangeStatus } = createFinder();

        const disposable = disposables.add(kernelFinder.registerKernelFinder(instance(finder)));

        assert.strictEqual(onDidChangeKernelFinderStatus.count, 0);
        assert.strictEqual(kernelFinder.status, 'idle');

        disposable.dispose();
        when(finder.status).thenReturn('discovering');
        ondDiChangeStatus.fire();

        assert.strictEqual(onDidChangeKernelFinderStatus.count, 0);
        assert.strictEqual(kernelFinder.status, 'idle');
    });
    test('When finder was first busy and then disposed, kernel finder status will not change', async () => {
        const { finder, ondDiChangeStatus } = createFinder();

        const disposable = disposables.add(kernelFinder.registerKernelFinder(instance(finder)));

        assert.strictEqual(onDidChangeKernelFinderStatus.count, 0);
        assert.strictEqual(kernelFinder.status, 'idle');

        when(finder.status).thenReturn('discovering');
        ondDiChangeStatus.fire();

        assert.strictEqual(onDidChangeKernelFinderStatus.count, 1);
        assert.strictEqual(kernelFinder.status, 'discovering');

        disposable.dispose();

        assert.strictEqual(onDidChangeKernelFinderStatus.count, 2);
        assert.strictEqual(kernelFinder.status, 'idle');
    });
    test('If first finder is busy and second is not , then kernel finder is still busy', async () => {
        const { finder: finder1, ondDiChangeStatus: ondDiChangeStatus1 } = createFinder();
        const { finder: finder2, ondDiChangeStatus: ondDiChangeStatus2 } = createFinder();

        disposables.add(kernelFinder.registerKernelFinder(instance(finder1)));
        disposables.add(kernelFinder.registerKernelFinder(instance(finder2)));

        assert.strictEqual(onDidChangeKernelFinderStatus.count, 0);
        assert.strictEqual(kernelFinder.status, 'idle');

        when(finder1.status).thenReturn('discovering');
        ondDiChangeStatus1.fire();

        assert.strictEqual(onDidChangeKernelFinderStatus.count, 1);
        assert.strictEqual(kernelFinder.status, 'discovering');

        when(finder2.status).thenReturn('discovering');
        ondDiChangeStatus2.fire();

        assert.strictEqual(onDidChangeKernelFinderStatus.count, 1);
        assert.strictEqual(kernelFinder.status, 'discovering');

        when(finder1.status).thenReturn('idle');
        ondDiChangeStatus1.fire();

        assert.strictEqual(onDidChangeKernelFinderStatus.count, 1);
        assert.strictEqual(kernelFinder.status, 'discovering');

        when(finder2.status).thenReturn('idle');
        ondDiChangeStatus2.fire();

        assert.strictEqual(onDidChangeKernelFinderStatus.count, 2);
        assert.strictEqual(kernelFinder.status, 'idle');
    });
    test('If first finder is not and second is disposed , then kernel finder is not busy', async () => {
        const { finder: finder1 } = createFinder();
        const { finder: finder2, ondDiChangeStatus: ondDiChangeStatus2 } = createFinder();

        disposables.add(kernelFinder.registerKernelFinder(instance(finder1)));
        const disposable2 = disposables.add(kernelFinder.registerKernelFinder(instance(finder2)));

        assert.strictEqual(onDidChangeKernelFinderStatus.count, 0);
        assert.strictEqual(kernelFinder.status, 'idle');

        when(finder2.status).thenReturn('discovering');
        ondDiChangeStatus2.fire();

        assert.strictEqual(onDidChangeKernelFinderStatus.count, 1);
        assert.strictEqual(kernelFinder.status, 'discovering');

        disposable2.dispose();

        assert.strictEqual(onDidChangeKernelFinderStatus.count, 2);
        assert.strictEqual(kernelFinder.status, 'idle');
    });
});
