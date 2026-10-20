// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Signal } from '@lumino/signaling';
import { KernelMessage } from '@jupyterlab/services';
import type { Kernel as JupyterKernel } from '@jupyterlab/services';
import type { IAnyMessageArgs } from '@jupyterlab/services/lib/kernel/kernel';
import { assert } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import { CancellationError, EventEmitter, Memento, NotebookDocument, Uri, WorkspaceConfiguration } from 'vscode';
import { WIDGET_MIMETYPE } from '../platform/common/constants';
import { createDeferred, raceTimeout } from '../platform/common/utils/async';
import type { Deferred } from '../platform/common/utils/async';
import { resolvableInstance } from '../test/datascience/helpers';
import { mockedVSCodeNamespaces, resetVSCodeMocks } from '../test/vscode-mock';
import { DisplayOptions } from './displayOptions';
import { Kernel } from './kernel';
import {
    IKernelController,
    IKernelSessionFactory,
    IJupyterKernelSession,
    LiveRemoteKernelConnectionMetadata
} from './types';

const widgetVersionOutPrefix = 'e976ee50-99ed-4aba-9b6b-9dcd5634d07d:IPyWidgets:';

interface PendingExecution {
    readonly code: string;
    readonly disposed: boolean;
    readonly done: Deferred<KernelMessage.IExecuteReplyMsg>;
    complete(version?: 7 | 8): void;
}

interface ConnectionGeneration {
    readonly connection: JupyterKernel.IKernelConnection;
    readonly anyMessage: TrackingAnyMessageSignal;
}

class TrackingAnyMessageSignal extends Signal<JupyterKernel.IKernelConnection, IAnyMessageArgs> {
    public readonly listenerConnected = createDeferred<void>();

    public override connect(
        slot: (sender: JupyterKernel.IKernelConnection, args: IAnyMessageArgs) => void,
        thisArg?: unknown
    ): boolean {
        const connected = super.connect(slot, thisArg);
        this.listenerConnected.resolve();
        return connected;
    }
}

class LiveRemoteKernelFixture {
    public readonly kernel: Kernel;
    private readonly session = mock<IJupyterKernelSession>();
    private readonly sessionInstance = resolvableInstance(this.session);
    private readonly onDidKernelSocketChange = new EventEmitter<void>();
    private readonly onDidDispose = new EventEmitter<void>();
    private readonly widgetRequestQueue: PendingExecution[] = [];
    private readonly pendingWidgetRequests = new Set<PendingExecution>();
    private widgetRequestWaiter?: Deferred<PendingExecution>;
    private nextRestartGate?: { entered: Deferred<void>; release: Deferred<void> };
    private generationCount = 0;
    private sessionDisposed = false;
    private generation: ConnectionGeneration;

    constructor() {
        resetVSCodeMocks();
        const configuration = mock<WorkspaceConfiguration>();
        when(configuration.get(anything(), anything())).thenCall((_, fallback) => fallback);
        when(mockedVSCodeNamespaces.workspace.getConfiguration(anything())).thenReturn(instance(configuration));

        this.generation = this.createGeneration();
        when(this.session.kind).thenReturn('remoteJupyter');
        when(this.session.status).thenReturn('idle');
        when(this.session.isDisposed).thenCall(() => this.sessionDisposed);
        when(this.session.kernel).thenCall(() => this.generation.connection);
        when(this.session.onDidKernelSocketChange).thenReturn(this.onDidKernelSocketChange.event);
        when(this.session.onDidDispose).thenReturn(this.onDidDispose.event);
        when(this.session.statusChanged).thenReturn(
            new Signal<IJupyterKernelSession, JupyterKernel.Status>(this.sessionInstance)
        );
        when(this.session.restart()).thenCall(async () => {
            const gate = this.nextRestartGate;
            this.nextRestartGate = undefined;
            if (gate) {
                gate.entered.resolve();
                await gate.release.promise;
            }
            this.generation = this.createGeneration();
        });
        when(this.session.shutdown()).thenResolve();
        when(this.session.dispose()).thenCall(() => {
            this.sessionDisposed = true;
            this.onDidDispose.fire();
        });

        const uri = Uri.file('review-live-remote-restart.ipynb');
        const notebook = mock<NotebookDocument>();
        when(notebook.uri).thenReturn(uri);
        const workspaceMemento = mock<Memento>();
        when(workspaceMemento.get(anything(), anything())).thenCall((_, fallback) => fallback);
        when(workspaceMemento.update(anything(), anything())).thenResolve();
        const factory = mock<IKernelSessionFactory>();
        when(factory.create(anything())).thenResolve(this.sessionInstance);
        const kernelModel = {
            id: 'review-live-remote',
            language: 'python',
            lastActivityTime: new Date(),
            model: undefined,
            name: 'python3',
            numberOfConnections: 1
        };
        this.kernel = new Kernel(
            uri,
            instance(notebook),
            LiveRemoteKernelConnectionMetadata.create({
                id: 'review-live-remote',
                baseUrl: 'http://localhost',
                kernelModel,
                serverProviderHandle: { extensionId: '', handle: 'review', id: 'review' }
            }),
            instance(factory),
            {
                enableExtendedPythonKernelCompletions: false,
                interruptTimeout: 1000,
                launchTimeout: 1000,
                runStartupCommands: [],
                themeMatplotlibPlots: false
            },
            instance(mock<IKernelController>()),
            [],
            instance(workspaceMemento),
            undefined,
            { isSupported: true }
        );
    }

    public start() {
        return this.kernel.start(new DisplayOptions(true));
    }

    public deferNextRestart() {
        const entered = createDeferred<void>();
        const release = createDeferred<void>();
        this.nextRestartGate = { entered, release };
        return {
            entered: entered.promise,
            release: () => release.resolve()
        };
    }

    public nextWidgetRequest(): Promise<PendingExecution> {
        const request = this.widgetRequestQueue.shift();
        if (request) {
            return Promise.resolve(request);
        }
        this.widgetRequestWaiter ??= createDeferred<PendingExecution>();
        return this.widgetRequestWaiter.promise;
    }

    public emitWidgetDisplayData() {
        this.generation.anyMessage.emit({
            direction: 'recv',
            msg: KernelMessage.createMessage<KernelMessage.IDisplayDataMsg>({
                channel: 'iopub',
                content: { data: { [WIDGET_MIMETYPE]: {} }, metadata: {} },
                msgType: 'display_data',
                session: 'review-live-remote',
                username: 'test'
            })
        });
    }

    public waitForWidgetListener(): Promise<void> {
        return this.generation.anyMessage.listenerConnected.promise;
    }

    public async dispose() {
        const disposal = this.kernel.dispose().then(
            () => true,
            (error) => error
        );
        this.nextRestartGate?.release.resolve();
        for (const request of this.pendingWidgetRequests) {
            request.complete();
        }
        try {
            const result = await raceTimeout(1000, disposal);
            if (result !== true) {
                throw result instanceof Error
                    ? result
                    : new Error('Live remote kernel fixture disposal did not settle');
            }
        } finally {
            this.onDidKernelSocketChange.dispose();
            this.onDidDispose.dispose();
            resetVSCodeMocks();
        }
    }

    private createGeneration(): ConnectionGeneration {
        const connection = mock<JupyterKernel.IKernelConnection>();
        const connectionInstance = resolvableInstance(connection);
        const anyMessage = new TrackingAnyMessageSignal(connectionInstance);
        when(connection.id).thenReturn(`review-live-remote-${++this.generationCount}`);
        when(connection.status).thenReturn('idle');
        when(connection.isDisposed).thenReturn(false);
        when(connection.anyMessage).thenReturn(anyMessage);
        when(connection.requestKernelInfo()).thenResolve(
            KernelMessage.createMessage<KernelMessage.IInfoReplyMsg>({
                channel: 'shell',
                content: {
                    banner: '',
                    help_links: [],
                    implementation: '',
                    implementation_version: '',
                    language_info: { name: '', version: '' },
                    protocol_version: '',
                    status: 'ok'
                },
                msgType: 'kernel_info_reply',
                session: 'review-live-remote',
                username: 'test'
            })
        );
        when(connection.requestExecute(anything(), anything())).thenCall(
            (content: KernelMessage.IExecuteRequestMsg['content']) => {
                const execution = this.createExecution(content.code);
                if (content.code.includes(widgetVersionOutPrefix)) {
                    this.enqueueWidgetRequest(execution);
                } else {
                    execution.complete();
                }
                return execution.future;
            }
        );
        return { connection: connectionInstance, anyMessage };
    }

    private createExecution(code: string): PendingExecution & {
        future: JupyterKernel.IShellFuture<KernelMessage.IExecuteRequestMsg, KernelMessage.IExecuteReplyMsg>;
    } {
        const future =
            mock<JupyterKernel.IShellFuture<KernelMessage.IExecuteRequestMsg, KernelMessage.IExecuteReplyMsg>>();
        const futureInstance = resolvableInstance(future);
        const done = createDeferred<KernelMessage.IExecuteReplyMsg>();
        let disposed = false;
        when(future.done).thenReturn(done.promise);
        when(future.isDisposed).thenCall(() => disposed);
        when(future.dispose()).thenCall(() => {
            if (!disposed) {
                disposed = true;
                done.reject(new CancellationError());
            }
        });
        return {
            code,
            done,
            get disposed() {
                return disposed;
            },
            future: futureInstance,
            complete: (version?: 7 | 8) => {
                const output = version
                    ? futureInstance.onIOPub?.(
                          KernelMessage.createMessage<KernelMessage.IStreamMsg>({
                              channel: 'iopub',
                              content: {
                                  name: 'stdout',
                                  text: `${widgetVersionOutPrefix}${version}.0.0\n`
                              },
                              msgType: 'stream',
                              session: 'review-live-remote',
                              username: 'test'
                          })
                      )
                    : undefined;
                void Promise.resolve(output).then(
                    () => {
                        if (!done.completed) {
                            done.resolve(
                                KernelMessage.createMessage<KernelMessage.IExecuteReplyMsg>({
                                    channel: 'shell',
                                    content: {
                                        execution_count: 1,
                                        payload: [],
                                        status: 'ok',
                                        user_expressions: {}
                                    },
                                    msgType: 'execute_reply',
                                    session: 'review-live-remote',
                                    username: 'test'
                                })
                            );
                        }
                    },
                    (error) => done.reject(error)
                );
            }
        };
    }

    private enqueueWidgetRequest(request: PendingExecution) {
        this.pendingWidgetRequests.add(request);
        const waiter = this.widgetRequestWaiter;
        this.widgetRequestWaiter = undefined;
        if (waiter) {
            waiter.resolve(request);
        } else {
            this.widgetRequestQueue.push(request);
        }
    }
}

suite('Kernel restart lifecycle', function () {
    this.timeout(10_000);
    test('Review regression restart non-raw shutdown during transport rejects readiness and completion', async () => {
        const fixture = new LiveRemoteKernelFixture();
        let restartedEvents = 0;
        fixture.kernel.onRestarted(() => (restartedEvents += 1));
        const transport = fixture.deferNextRestart();
        try {
            assert.isDefined(await raceTimeout(2000, fixture.start()));
            const restart = fixture.kernel.restart().then(
                () => undefined,
                (error) => error
            );
            const readiness = fixture.kernel.restarting.then(
                () => undefined,
                (error) => error
            );
            assert.isTrue(
                await raceTimeout(
                    2000,
                    transport.entered.then(() => true)
                )
            );

            const shutdown = fixture.kernel.shutdown().then(
                () => undefined,
                (error) => error
            );
            transport.release();

            assert.instanceOf(await raceTimeout(4000, restart), CancellationError);
            assert.instanceOf(await raceTimeout(4000, readiness), CancellationError);
            assert.isTrue(
                await raceTimeout(
                    4000,
                    shutdown.then(() => true)
                )
            );
            assert.strictEqual(restartedEvents, 0);
            assert.isUndefined(fixture.kernel.session);
        } finally {
            transport.release();
            await fixture.dispose();
        }
    });

    test('Review regression widget keeps live-remote default-token detection nonblocking', async () => {
        const fixture = new LiveRemoteKernelFixture();
        const initialRequest = fixture.nextWidgetRequest();
        try {
            assert.isDefined(await raceTimeout(2000, fixture.start()));
            const request = await raceTimeout(2000, initialRequest);
            assert.isDefined(request);
            assert.isFalse(request!.disposed);
        } finally {
            await fixture.dispose();
        }
    });

    test('Review regression widget ignores a late old-generation response after restart', async () => {
        const fixture = new LiveRemoteKernelFixture();
        const initialRequest = fixture.nextWidgetRequest();
        try {
            assert.isDefined(await raceTimeout(2000, fixture.start()));
            const initial = await raceTimeout(2000, initialRequest);
            assert.isDefined(initial);
            initial!.complete();
            await initial!.done.promise;
            assert.isTrue(
                await raceTimeout(
                    2000,
                    fixture.waitForWidgetListener().then(() => true)
                )
            );

            const versions: (7 | 8 | undefined)[] = [];
            const versionResolved = createDeferred<7 | 8>();
            const disposable = fixture.kernel.onIPyWidgetVersionResolved((version) => {
                versions.push(version);
                if (version) {
                    versionResolved.resolve(version);
                }
            });
            try {
                const oldRequest = fixture.nextWidgetRequest();
                fixture.emitWidgetDisplayData();
                const old = await raceTimeout(2000, oldRequest);
                assert.isDefined(old);

                const nextInitialRequest = fixture.nextWidgetRequest();
                assert.isTrue(
                    await raceTimeout(
                        2000,
                        fixture.kernel.restart().then(() => true)
                    )
                );
                const nextInitial = await raceTimeout(2000, nextInitialRequest);
                assert.isDefined(nextInitial);
                nextInitial!.complete();
                await nextInitial!.done.promise;
                assert.isTrue(
                    await raceTimeout(
                        2000,
                        fixture.waitForWidgetListener().then(() => true)
                    )
                );
                versions.length = 0;

                old!.complete(7);
                assert.isTrue(old!.disposed);

                const freshRequest = fixture.nextWidgetRequest();
                fixture.emitWidgetDisplayData();
                const fresh = await raceTimeout(2000, freshRequest);
                assert.isDefined(fresh);
                fresh!.complete(8);
                await fresh!.done.promise;

                assert.strictEqual(await raceTimeout(2000, versionResolved.promise), 8);
                assert.deepEqual(versions, [8]);
                assert.strictEqual(fixture.kernel.ipywidgetsVersion, 8);
            } finally {
                disposable.dispose();
            }
        } finally {
            await fixture.dispose();
        }
    });

    test('Review regression widget ignores a late response after disposal', async () => {
        const fixture = new LiveRemoteKernelFixture();
        const initialRequest = fixture.nextWidgetRequest();
        try {
            assert.isDefined(await raceTimeout(2000, fixture.start()));
            const initial = await raceTimeout(2000, initialRequest);
            assert.isDefined(initial);
            initial!.complete();
            await initial!.done.promise;
            assert.isTrue(
                await raceTimeout(
                    2000,
                    fixture.waitForWidgetListener().then(() => true)
                )
            );

            const versions: (7 | 8 | undefined)[] = [];
            const versionResolved = createDeferred<7 | 8>();
            const disposable = fixture.kernel.onIPyWidgetVersionResolved((version) => {
                versions.push(version);
                if (version) {
                    versionResolved.resolve(version);
                }
            });
            try {
                const lateRequest = fixture.nextWidgetRequest();
                fixture.emitWidgetDisplayData();
                const late = await raceTimeout(2000, lateRequest);
                assert.isDefined(late);

                const disposal = fixture.kernel.dispose().then(() => true);
                late!.complete(8);
                assert.isTrue(await raceTimeout(2000, disposal));
                assert.isTrue(late!.disposed);
                assert.isUndefined(
                    await raceTimeout(
                        500,
                        versionResolved.promise.then(() => true)
                    )
                );
                assert.deepEqual(versions, []);
                assert.isUndefined(fixture.kernel.ipywidgetsVersion);
            } finally {
                disposable.dispose();
            }
        } finally {
            await fixture.dispose();
        }
    });
});
