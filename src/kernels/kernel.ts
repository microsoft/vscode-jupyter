// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import uuid from 'uuid/v4';
import type * as nbformat from '@jupyterlab/nbformat';
import type { KernelMessage } from '@jupyterlab/services';
import { Observable } from 'rxjs/Observable';
import { ReplaySubject } from 'rxjs/ReplaySubject';
import {
    CancellationTokenSource,
    Event,
    EventEmitter,
    ColorThemeKind,
    Disposable,
    Uri,
    NotebookDocument,
    Memento
} from 'vscode';
import {
    CodeSnippets,
    Identifiers,
    WIDGET_MIMETYPE,
    WIDGET_VERSION_NON_PYTHON_KERNELS
} from '../platform/common/constants';
import { IApplicationShell } from '../platform/common/application/types';
import { WrappedError } from '../platform/errors/types';
import { disposeAllDisposables, splitLines } from '../platform/common/helpers';
import { traceInfo, traceInfoIfCI, traceError, traceVerbose, traceWarning } from '../platform/logging';
import { getDisplayPath, getFilePath } from '../platform/common/platform/fs-paths';
import { Resource, IDisposable, IDisplayOptions } from '../platform/common/types';
import { createDeferred, raceTimeout, raceTimeoutError } from '../platform/common/utils/async';
import { DataScience } from '../platform/common/utils/localize';
import { noop } from '../platform/common/utils/misc';
import { StopWatch } from '../platform/common/utils/stopWatch';
import { concatMultilineString, getResourceType } from '../platform/common/utils';
import { JupyterConnectError } from '../platform/errors/jupyterConnectError';
import { sendKernelTelemetryEvent } from './telemetry/sendKernelTelemetryEvent';
import {
    initializeInteractiveOrNotebookTelemetryBasedOnUserAction,
    trackKernelResourceInformation
} from './telemetry/helper';
import { Telemetry } from '../telemetry';
import { executeSilently, getDisplayNameOrNameOfKernelConnection, isPythonKernelConnection } from './helpers';
import {
    IKernel,
    IKernelSession,
    InterruptResult,
    IStartupCodeProvider,
    KernelConnectionMetadata,
    KernelSocketInformation,
    IBaseKernel,
    KernelActionSource,
    KernelHooks,
    IKernelSettings,
    IKernelController,
    IThirdPartyKernel,
    IKernelSessionFactory
} from './types';
import { Cancellation, isCancellationError } from '../platform/common/cancellation';
import { KernelProgressReporter } from '../platform/progress/kernelProgressReporter';
import { DisplayOptions } from './displayOptions';
import { SilentExecutionErrorOptions } from './helpers';
import dedent from 'dedent';
import { IAnyMessageArgs } from '@jupyterlab/services/lib/kernel/kernel';
import { getKernelInfo } from './kernelInfo';
import { KernelInterruptTimeoutError } from './errors/kernelInterruptTimeoutError';

const widgetVersionOutPrefix = 'e976ee50-99ed-4aba-9b6b-9dcd5634d07d:IPyWidgets:';
/**
 * Sometimes we send code internally, e.g. to determine version of IPyWidgets and the like.
 * Such messages need not be mirrored with the renderer.
 */
export function shouldMessageBeMirroredWithRenderer(msg: KernelMessage.IExecuteRequestMsg | string) {
    let code = typeof msg === 'string' ? msg : '';
    if (typeof msg !== 'string' && 'content' in msg && 'code' in msg.content && typeof msg.content.code === 'string') {
        code = msg.content.code;
    }

    if (code.includes(widgetVersionOutPrefix)) {
        return false;
    }
    return true;
}

export function isKernelDead(k: IBaseKernel) {
    return (
        k.status === 'dead' ||
        (k.status === 'terminating' && !k.disposed && !k.disposing) ||
        (!k.disposed &&
            !k.disposing &&
            (k.session?.status == 'unknown' || k.session?.kernel?.status == 'unknown') &&
            (k.session.kernel?.isDisposed || k.session.isDisposed))
    );
}

export function isKernelSessionDead(k: IKernelSession) {
    return (
        k.status === 'dead' ||
        (k.status === 'terminating' && !k.isDisposed) ||
        (!k.isDisposed &&
            (k.status == 'unknown' || k.kernel?.status == 'unknown') &&
            (k.kernel?.isDisposed || k.isDisposed))
    );
}

type Hook = (...args: unknown[]) => Promise<void>;
/**
 * Represents an active kernel process running on the jupyter (or local) machine.
 */
abstract class BaseKernel implements IBaseKernel {
    protected readonly disposables: IDisposable[] = [];
    private _ipywidgetsVersion?: 7 | 8;
    public get ipywidgetsVersion() {
        return this._ipywidgetsVersion;
    }
    private _onIPyWidgetVersionResolved = new EventEmitter<7 | 8 | undefined>();
    public get onIPyWidgetVersionResolved() {
        return this._onIPyWidgetVersionResolved.event;
    }

    get onStatusChanged(): Event<KernelMessage.Status> {
        return this._onStatusChanged.event;
    }
    get onRestarted(): Event<void> {
        return this._onRestarted.event;
    }
    get onStarted(): Event<void> {
        return this._onStarted.event;
    }
    get onDisposed(): Event<void> {
        return this._onDisposed.event;
    }
    get creator(): KernelActionSource {
        return this._creator;
    }
    get startedAtLeastOnce() {
        return this._startedAtLeastOnce;
    }
    private _info?: KernelMessage.IInfoReplyMsg['content'];
    private _startedAtLeastOnce?: boolean;
    get info(): KernelMessage.IInfoReplyMsg['content'] | undefined {
        return this._info;
    }
    get status(): KernelMessage.Status {
        if (this._jupyterSessionPromise && !this._session) {
            return 'starting';
        }
        return this._session?.status ?? (this.isKernelDead ? 'dead' : 'unknown');
    }
    get disposed(): boolean {
        return this._disposed === true || this._session?.isDisposed === true;
    }
    get disposing(): boolean {
        return this._disposing === true;
    }
    get kernelSocket(): Observable<KernelSocketInformation | undefined> {
        return this._kernelSocket.asObservable();
    }
    private _session?: IKernelSession;
    /**
     * If the session died, then ensure the status is set to `dead`.
     * We need to provide an accurate status.
     * `unknown` is generally used to indicate jupyter kernel hasn't started.
     * If a jupyter kernel dies after it has started, then status is set to `dead`.
     */
    private isKernelDead?: boolean;
    public get session(): IKernelSession | undefined {
        return this._session;
    }
    private _disposed?: boolean;
    private _disposing?: boolean;
    private _ignoreJupyterSessionDisposedErrors?: boolean;
    private readonly _kernelSocket = new ReplaySubject<KernelSocketInformation | undefined>();
    private readonly _onStatusChanged = new EventEmitter<KernelMessage.Status>();
    private readonly _onRestarted = new EventEmitter<void>();
    private readonly _onStarted = new EventEmitter<void>();
    private readonly _onDisposed = new EventEmitter<void>();
    private _jupyterSessionPromise?: Promise<IKernelSession>;
    private readonly hookedSessionForEvents = new WeakSet<IKernelSession>();
    private hooks = new Map<KernelHooks, Set<Hook>>();
    private startCancellation = new CancellationTokenSource();
    private startupUI = new DisplayOptions(true);
    private disposingPromise?: Promise<void>;
    private _interruptPromise?: Promise<InterruptResult>;
    private _restartPromise?: Promise<void>;
    public get restarting() {
        return this._restartPromise || Promise.resolve();
    }
    constructor(
        public readonly id: string,
        public readonly uri: Uri,
        public readonly resourceUri: Resource,
        public readonly kernelConnectionMetadata: Readonly<KernelConnectionMetadata>,
        private readonly sessionCreator: IKernelSessionFactory,
        protected readonly kernelSettings: IKernelSettings,
        protected readonly appShell: IApplicationShell,
        protected readonly startupCodeProviders: IStartupCodeProvider[],
        public readonly _creator: KernelActionSource,
        private readonly workspaceMemento: Memento
    ) {
        this.disposables.push(this._onStatusChanged);
        this.disposables.push(this._onRestarted);
        this.disposables.push(this._onStarted);
        this.disposables.push(this._onDisposed);
        this.disposables.push(this._onIPyWidgetVersionResolved);
        this.disposables.push({ dispose: () => this._kernelSocket.unsubscribe() });
        trackKernelResourceInformation(this.resourceUri, {
            kernelConnection: this.kernelConnectionMetadata,
            actionSource: this.creator,
            disableUI: this.startupUI.disableUI
        }).catch(noop);
        this.startupUI.onDidChangeDisableUI(() => {
            if (!this.startupUI.disableUI) {
                trackKernelResourceInformation(this.resourceUri, {
                    disableUI: false
                }).catch(noop);
            }
        }, this.disposables);
    }

    public addHook(
        event: KernelHooks,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cb: (...args: any[]) => Promise<void>,
        thisArgs?: unknown,
        disposables?: IDisposable[]
    ): IDisposable {
        const eventHook = this.hooks.get(event) || new Set<(...args: unknown[]) => Promise<void>>();
        this.hooks.set(event, eventHook);
        cb = thisArgs ? cb.bind(thisArgs) : cb;
        eventHook.add(cb);
        const disposable = {
            dispose: () => {
                eventHook.delete(cb);
            }
        };
        if (disposables) {
            disposables.push(disposable);
        }
        return disposable;
    }
    public async start(options?: IDisplayOptions): Promise<IKernelSession> {
        // Possible this cancellation was cancelled previously.
        if (this.startCancellation.token.isCancellationRequested) {
            this.startCancellation.dispose();
            this.startCancellation = new CancellationTokenSource();
        }
        return this.startJupyterSession(options);
    }
    /**
     * Interrupts the execution of cells.
     * If we don't have a kernel (Jupyter Session) available, then just abort all of the cell executions.
     */
    public async interrupt(): Promise<void> {
        const pendingExecutions = Promise.all(
            Array.from(this.hooks.get('willInterrupt') || new Set<Hook>()).map((h) => h())
        );
        traceInfo(`Interrupt requested ${getDisplayPath(this.resourceUri || this.uri)}`);
        let result: InterruptResult;
        try {
            const session = this._jupyterSessionPromise
                ? await this._jupyterSessionPromise.catch(() => undefined)
                : undefined;
            traceInfo('Interrupt kernel execution');

            if (!session) {
                traceInfo('No kernel session to interrupt');
                this._interruptPromise = undefined;
                result = InterruptResult.Success;
            } else {
                // Interrupt the active execution
                result = this._interruptPromise
                    ? await this._interruptPromise
                    : await (this._interruptPromise = this.interruptExecution(session, pendingExecutions));

                // Done interrupting, clear interrupt promise
                this._interruptPromise = undefined;
            }
        } finally {
            await Promise.all(
                Array.from(this.hooks.get('interruptCompleted') || new Set<Hook>()).map((h) => h())
            ).catch(noop);
        }

        traceInfo(`Interrupt requested & sent for ${getDisplayPath(this.uri)} in notebookEditor.`);
        if (result === InterruptResult.TimedOut) {
            const message = DataScience.restartKernelAfterInterruptMessage;
            const yes = DataScience.restartKernelMessageYes;
            const v = await this.appShell.showInformationMessage(message, { modal: true }, yes);
            if (v === yes) {
                await this.restart();
            }
        }
    }
    public async dispose(): Promise<void> {
        traceInfo(`Dispose Kernel '${getDisplayPath(this.uri)}' associated with '${getDisplayPath(this.resourceUri)}'`);
        this._disposing = true;
        if (this.disposingPromise) {
            return this.disposingPromise;
        }
        this._ignoreJupyterSessionDisposedErrors = true;
        this.startCancellation.cancel();
        const disposeImpl = async () => {
            const promises: Promise<void>[] = [];
            promises.push(
                Promise.all(Array.from(this.hooks.get('willCancel') || new Set<Hook>()).map((h) => h()))
                    .then(noop)
                    .catch(noop)
            );
            this._session = this._session
                ? this._session
                : this._jupyterSessionPromise
                ? await this._jupyterSessionPromise.catch(() => undefined)
                : undefined;
            this._jupyterSessionPromise = undefined;
            if (this._session) {
                promises.push(this._session.disposeAsync().catch(noop));
                this._session = undefined;
            }
            this._disposed = true;
            this._onDisposed.fire();
            this._onStatusChanged.fire('dead');
            try {
                await Promise.all(promises);
            } finally {
                this.startCancellation.dispose();
                disposeAllDisposables(this.disposables);
            }
        };
        this.disposingPromise = disposeImpl();
        await this.disposingPromise;
    }
    public async restart(): Promise<void> {
        try {
            const resourceType = getResourceType(this.resourceUri);
            traceInfo(`Restart requested ${getDisplayPath(this.uri)}`);
            await Promise.all(
                Array.from(this.hooks.get('willRestart') || new Set<Hook>()).map((h) => h(this._jupyterSessionPromise))
            );
            this.startCancellation.cancel(); // Cancel any pending starts.
            this.startCancellation.dispose();
            const stopWatch = new StopWatch();
            try {
                // Check if the session was started already.
                // Note, it could be empty if we were starting this and it got cancelled due to us
                // cancelling the token earlier.
                const session = this._jupyterSessionPromise
                    ? await this._jupyterSessionPromise.catch(() => undefined)
                    : undefined;

                if (session) {
                    // We already have a session, now try to restart that session instead of starting a whole new one.
                    // Just use the internal session. Pending cells should have been canceled by the caller
                    // Try to restart the current session if possible.
                    if (!this._restartPromise) {
                        // Just use the internal session. Pending cells should have been canceled by the caller
                        this._restartPromise = session.restart();
                        this._restartPromise
                            // Done restarting, clear restart promise
                            .finally(() => (this._restartPromise = undefined))
                            .catch(noop);
                    }
                    await this._restartPromise;

                    // Re-create the cancel token as we cancelled this earlier in this method.
                    this.startCancellation = new CancellationTokenSource();
                } else {
                    // If the session died, then start a new session.
                    // Or possible the previously pending start was cancelled above.
                    await this.start(new DisplayOptions(false));
                }
                sendKernelTelemetryEvent(
                    this.resourceUri,
                    Telemetry.NotebookRestart,
                    { duration: stopWatch.elapsedTime },
                    { resourceType }
                );
            } catch (ex) {
                traceError(`Restart failed ${getDisplayPath(this.uri)}`, ex);
                this._ignoreJupyterSessionDisposedErrors = true;
                // If restart fails, kill the associated session.
                const session = this._session;
                this._session = undefined;
                this._jupyterSessionPromise = undefined;
                // If we get a kernel promise failure, then restarting timed out. Just shutdown and restart the entire server.
                // Note, this code might not be necessary, as such an error is thrown only when interrupting a kernel times out.
                sendKernelTelemetryEvent(
                    this.resourceUri,
                    Telemetry.NotebookRestart,
                    { duration: stopWatch.elapsedTime },
                    undefined,
                    ex
                );
                await session?.disposeAsync().catch(noop);
                this._ignoreJupyterSessionDisposedErrors = false;
                throw ex;
            }

            // Interactive window needs a restart sys info
            await this.initializeAfterStart(this._session);

            // Indicate a restart occurred if it succeeds
            this._onRestarted.fire();
        } catch (ex) {
            traceError(`Failed to restart kernel ${getDisplayPath(this.uri)}`, ex);
            throw ex;
        } finally {
            Promise.all(Array.from(this.hooks.get('restartCompleted') || new Set<Hook>()).map((h) => h())).catch(noop);
        }
    }
    protected async startJupyterSession(options: IDisplayOptions = new DisplayOptions(false)): Promise<IKernelSession> {
        this._startedAtLeastOnce = true;
        if (!options.disableUI) {
            this.startupUI.disableUI = false;
        }
        options.onDidChangeDisableUI(() => {
            if (!options.disableUI && this.startupUI.disableUI) {
                this.startupUI.disableUI = false;
            }
        });
        if (!this.startupUI.disableUI) {
            // This means the user is actually running something against the kernel (deliberately).
            await initializeInteractiveOrNotebookTelemetryBasedOnUserAction(
                this.resourceUri,
                this.kernelConnectionMetadata
            );
        } else {
            this.startupUI.onDidChangeDisableUI(
                () => {
                    if (this.disposing || this.disposed || this.startupUI.disableUI) {
                        return;
                    }
                    // This means the user is actually running something against the kernel (deliberately).
                    initializeInteractiveOrNotebookTelemetryBasedOnUserAction(
                        this.resourceUri,
                        this.kernelConnectionMetadata
                    ).catch(noop);
                },
                this,
                this.disposables
            );
        }
        if (!this._jupyterSessionPromise) {
            const stopWatch = new StopWatch();
            await trackKernelResourceInformation(this.resourceUri, {
                kernelConnection: this.kernelConnectionMetadata,
                actionSource: this.creator
            });

            this._jupyterSessionPromise = this.createJupyterSession()
                .then((session) => {
                    sendKernelTelemetryEvent(this.resourceUri, Telemetry.PerceivedJupyterStartupNotebook, {
                        duration: stopWatch.elapsedTime
                    });
                    return session;
                })
                .catch((ex) => {
                    traceInfoIfCI(
                        `Failed to create Jupyter Session in Kernel.startNotebook for ${getDisplayPath(this.uri)}`
                    );
                    // If we fail also clear the promise.
                    this.startCancellation.cancel();
                    this._jupyterSessionPromise = undefined;
                    throw ex;
                });
        }
        this._jupyterSessionPromise.finally(() => this.sendKernelStartedTelemetry()).catch(noop);
        return this._jupyterSessionPromise;
    }

    private async interruptExecution(
        session: IKernelSession,
        pendingExecutions: Promise<unknown>
    ): Promise<InterruptResult> {
        const restarted = createDeferred<boolean>();
        const stopWatch = new StopWatch();
        // Listen to status change events so we can tell if we're restarting
        const restartHandler = (e: KernelMessage.Status) => {
            if (e === 'restarting' || e === 'autorestarting') {
                // We restarted the kernel.
                traceWarning('Kernel restarting during interrupt');

                // Indicate we restarted the race below
                restarted.resolve(true);
            }
        };
        const restartHandlerToken = session.onSessionStatusChanged(restartHandler);

        if (session && session.kernel) {
            traceInfo(`Interrupting kernel: ${session.kernel.name}`);

            // Start our interrupt. If it fails, indicate a restart
            await raceTimeoutError(
                this.kernelSettings.interruptTimeout,
                new KernelInterruptTimeoutError(this.kernelConnectionMetadata),
                session.kernel.interrupt()
            ).catch((exc) => {
                traceWarning(`Error during interrupt: ${exc}`);
                restarted.resolve(true);
            });
        }

        const promise = (async () => {
            try {
                // Wait for all of the pending cells to finish or the timeout to fire
                return await raceTimeout(
                    this.kernelSettings.interruptTimeout,
                    InterruptResult.TimedOut,
                    pendingExecutions.then(() => InterruptResult.Success),
                    restarted.promise.then(() => InterruptResult.Restarted)
                );
            } catch (exc) {
                // Something failed. See if we restarted or not.
                if (restarted.completed) {
                    return InterruptResult.Restarted;
                }

                // Otherwise a real error occurred.
                sendKernelTelemetryEvent(
                    this.resourceUri,
                    Telemetry.NotebookInterrupt,
                    { duration: stopWatch.elapsedTime },
                    undefined,
                    exc
                );
                throw exc;
            } finally {
                restartHandlerToken.dispose();
            }
        })();

        return promise.then((result) => {
            sendKernelTelemetryEvent(
                this.resourceUri,
                Telemetry.NotebookInterrupt,
                { duration: stopWatch.elapsedTime },
                {
                    result
                }
            );
            return result;
        });
    }

    private async createJupyterSession(): Promise<IKernelSession> {
        let disposables: Disposable[] = [];
        try {
            // No need to block kernel startup on UI updates.
            let pythonInfo = '';
            const interpreter = this.kernelConnectionMetadata.interpreter;
            if (interpreter) {
                const info: string[] = [];
                info.push(`Python Path: ${getDisplayPath(interpreter.uri)}`);
                info.push(interpreter.envType || '');
                info.push(interpreter.envName || '');
                if (interpreter.version) {
                    info.push(`${interpreter.version.major}.${interpreter.version.minor}.${interpreter.version.patch}`);
                }
                pythonInfo = ` (${info.filter((s) => s).join(', ')})`;
            }
            traceInfo(
                `Starting Kernel ${this.kernelConnectionMetadata.kind}, ${
                    this.kernelConnectionMetadata.id
                } ${pythonInfo} for '${getDisplayPath(this.uri)}' (disableUI=${this.startupUI.disableUI})`
            );
            this.createProgressIndicator(disposables);
            this.isKernelDead = false;
            this._onStatusChanged.fire('starting');
            const session = await this.sessionCreator.create({
                resource: this.resourceUri,
                ui: this.startupUI,
                kernelConnection: this.kernelConnectionMetadata,
                token: this.startCancellation.token,
                creator: this.creator
            });
            Cancellation.throwIfCanceled(this.startCancellation.token);
            await this.initializeAfterStart(session);

            this.sendKernelStartedTelemetry();
            this._session = session;
            this._onStarted.fire();
            return session;
        } catch (ex) {
            // Don't log errors if UI is disabled (e.g. auto starting a kernel)
            // Else we just pollute the logs with lots of noise.
            if (this.startupUI.disableUI) {
                traceVerbose(
                    `failed to create IJupyterKernelConnectionSession in kernel, UI Disabled = ${this.startupUI.disableUI}`,
                    ex
                );
            } else if (!this.startCancellation.token && !isCancellationError(ex)) {
                traceError(
                    `failed to create IJupyterKernelConnectionSession in kernel, UI Disabled = ${this.startupUI.disableUI}`,
                    ex
                );
            }
            Cancellation.throwIfCanceled(this.startCancellation.token);
            if (ex instanceof JupyterConnectError) {
                throw ex;
            }
            // Provide a user friendly message in case `ex` is some error thats not throw by us.
            const message = DataScience.sessionStartFailedWithKernel(
                getDisplayNameOrNameOfKernelConnection(this.kernelConnectionMetadata)
            );
            throw WrappedError.from(message + ' ' + ('message' in ex ? ex.message : ex.toString()), ex);
        } finally {
            disposeAllDisposables(disposables);
        }
    }
    private uiWasDisabledWhenKernelStartupTelemetryWasLastSent?: boolean;
    private startTelemetrySent?: boolean;
    protected sendKernelStartedTelemetry(): void {
        if (
            this.uiWasDisabledWhenKernelStartupTelemetryWasLastSent &&
            this.uiWasDisabledWhenKernelStartupTelemetryWasLastSent === this.startupUI.disableUI
        ) {
            return;
        } else {
            // This means the UI is enabled, which happens when starting kernels or the like.
            // i.e. we can display error messages and the like to the user now.
            // Note: UI is disabled during auto start.
            // Last time we sent kernel telemetry event, it was sent indicating the fact that the ui was disabled,
            // Now we need to send the event `Telemetry.NotebookStart` again indicating the fact that the ui is enabled & that the kernel was started successfully based on a user action.
        }
        if (this.startTelemetrySent && !this.startupUI.disableUI) {
            return;
        }

        this.uiWasDisabledWhenKernelStartupTelemetryWasLastSent = this.startupUI.disableUI === true;
        this.startTelemetrySent = true;
        // The corresponding failure telemetry property for the `Telemetry.NotebookStart` event will be sent in the Error Handler,
        // after we analyze the error.
        sendKernelTelemetryEvent(this.resourceUri, Telemetry.NotebookStart, undefined, {
            disableUI: this.startupUI.disableUI
        });
    }

    private createProgressIndicator(disposables: IDisposable[]) {
        // Even if we're not supposed to display the progress indicator,
        // create it and keep it hidden.
        const progressReporter = KernelProgressReporter.createProgressReporter(
            this.resourceUri,
            DataScience.connectingToKernel(getDisplayNameOrNameOfKernelConnection(this.kernelConnectionMetadata)),
            this.startupUI.disableUI
        );
        disposables.push(progressReporter);
        if (this.startupUI.disableUI) {
            // Display the hidden progress indicator if it was previously hidden.
            this.startupUI.onDidChangeDisableUI(
                () => {
                    if (this.disposing || this.disposed || this.startupUI.disableUI) {
                        return;
                    }
                    if (progressReporter.show) {
                        progressReporter.show();
                    }
                },
                this,
                disposables
            );
        }
    }

    protected async initializeAfterStart(session: IKernelSession | undefined) {
        await Promise.all(Array.from(this.hooks.get('didStart') || new Set<Hook>()).map((h) => h()));
        traceVerbose(`Started running kernel initialization for ${getDisplayPath(this.uri)}`);
        if (!session) {
            traceVerbose('Not running kernel initialization');
            return;
        }
        if (!this.hookedSessionForEvents.has(session)) {
            this.hookedSessionForEvents.add(session);
            session.kernelSocket.subscribe(this._kernelSocket);
            session.onDidDispose(() => {
                traceInfoIfCI(
                    `Kernel got disposed as a result of session.onDisposed ${getDisplayPath(
                        this.resourceUri || this.uri
                    )}`
                );
                // Ignore when session is disposed as a result of failed restarts.
                if (!this._ignoreJupyterSessionDisposedErrors) {
                    traceInfo(
                        `Kernel got disposed as a result of session.onDisposed ${getDisplayPath(
                            this.resourceUri || this.uri
                        )} & _ignoreJupyterSessionDisposedErrors = false.`
                    );
                    const isActiveSessionDead = this._session === session;

                    this._jupyterSessionPromise = undefined;
                    this._session = undefined;

                    // If the active session died, then kernel is dead.
                    if (isActiveSessionDead) {
                        this.isKernelDead = true;
                        this._onStatusChanged.fire('dead');
                    }
                }
            });
            const statusChangeHandler = (status: KernelMessage.Status) => {
                this._onStatusChanged.fire(status);
            };
            this.disposables.push(session.onSessionStatusChanged(statusChangeHandler));
        }

        // So that we don't have problems with ipywidgets, always register the default ipywidgets comm target.
        // Restart sessions and retries might make this hard to do correctly otherwise.
        session.kernel?.registerCommTarget(Identifiers.DefaultCommTarget, noop);

        if (this.kernelConnectionMetadata.kind === 'connectToLiveRemoteKernel') {
            // As users can have IPyWidgets at any point in time, we need to determine the version of ipywidgets
            // This must happen early on as the state of the kernel needs to be synced with the Kernel in the webview (renderer)
            // And the longer we wait, the more data we need to hold onto in memory that later needs to be sent to the kernel in renderer.
            this.determineVersionOfIPyWidgets(session).catch((ex) =>
                traceError(`Failed to determine IPyWidget version`, ex)
            );

            // Gather all of the startup code at one time and execute as one cell
            this.gatherInternalStartupCode()
                .then((startupCode) =>
                    this.executeSilently(session, startupCode, {
                        traceErrors: true,
                        traceErrorsMessage: 'Error executing jupyter extension internal startup code'
                    })
                )
                .catch((ex) => traceError(`Failed to execute internal startup code`, ex));
        } else {
            // As users can have IPyWidgets at any point in time, we need to determine the version of ipywidgets
            // This must happen early on as the state of the kernel needs to be synced with the Kernel in the webview (renderer)
            // And the longer we wait, the more data we need to hold onto in memory that later needs to be sent to the kernel in renderer.
            await this.determineVersionOfIPyWidgets(session);

            // Gather all of the startup code at one time and execute as one cell
            const startupCode = await this.gatherInternalStartupCode();
            await this.executeSilently(session, startupCode, {
                traceErrors: true,
                traceErrorsMessage: 'Error executing jupyter extension internal startup code'
            });
            // Run user specified startup commands
            await this.executeSilently(session, this.getUserStartupCommands(), { traceErrors: false });
        }

        // Then request our kernel info (indicates kernel is ready to go)
        try {
            traceVerbose('Requesting Kernel info');
            this._info = await getKernelInfo(session, this.kernelConnectionMetadata, this.workspaceMemento);
        } catch (ex) {
            traceWarning('Failed to request KernelInfo', ex);
        }
        if (this.kernelConnectionMetadata.kind !== 'connectToLiveRemoteKernel') {
            traceVerbose('End running kernel initialization, now waiting for idle');
            await session.waitForIdle(this.kernelSettings.launchTimeout, this.startCancellation.token);
            traceVerbose('End running kernel initialization, session is idle');
        }
    }
    /**
     * Determines the version of IPyWidgets used in the kernel
     * For non-python kernels, we assume the version of IPyWidgets is 7.
     * For Python we just run a block of Python code to determine the version.
     */
    private async determineVersionOfIPyWidgets(session: IKernelSession) {
        if (!isPythonKernelConnection(this.kernelConnectionMetadata)) {
            // For all other kernels, assume we are using the older version of IPyWidgets.
            // There are very few kernels that support IPyWidgets, however IPyWidgets 8 is very new
            // & it is unlikely that others have supported this new version.
            this._ipywidgetsVersion == WIDGET_VERSION_NON_PYTHON_KERNELS;
            this._onIPyWidgetVersionResolved.fire(WIDGET_VERSION_NON_PYTHON_KERNELS);
            return;
        }
        const determineVersionImpl = async () => {
            const codeToDetermineIPyWidgetsVersion = dedent`
        try:
            import ipywidgets as _VSCODE_ipywidgets
            print("${widgetVersionOutPrefix}" + _VSCODE_ipywidgets.__version__)
            del _VSCODE_ipywidgets
        except:
            pass
        `;

            const version = await this.executeSilently(session, [codeToDetermineIPyWidgetsVersion]).catch((ex) =>
                traceError('Failed to determine version of IPyWidgets', ex)
            );
            if (Array.isArray(version)) {
                const isVersion8 = version.some((output) =>
                    (output.text || '')?.toString().includes(`${widgetVersionOutPrefix}8.`)
                );
                const isVersion7 = version.some((output) =>
                    (output.text || '')?.toString().includes(`${widgetVersionOutPrefix}7.`)
                );

                const newVersion = (this._ipywidgetsVersion = isVersion7 ? 7 : isVersion8 ? 8 : undefined);
                traceVerbose(`Determined IPyWidgets Version as ${newVersion} and event fired`);
                // If user does not have ipywidgets installed, then this event will never get fired.
                this._ipywidgetsVersion == newVersion;
                this._onIPyWidgetVersionResolved.fire(newVersion);
            } else {
                traceWarning('Failed to determine IPyKernel Version', JSON.stringify(version));
            }
        };
        await determineVersionImpl();

        // If we do not have the version of IPyWidgets, its possible the user has not installed it.
        // However while running cells users can install IPykernel via `!pip install ipywidgets` or the like.
        // Hence we need to monitor messages that require widgets and the determine the version of widgets at that point in time.
        // This is not ideal, but its the best we can do.
        if (!this._ipywidgetsVersion && this.session?.kernel) {
            const anyMessageHandler = // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (_: unknown, msg: IAnyMessageArgs) => {
                    if (msg.direction === 'send') {
                        return;
                    }
                    const message = msg.msg;
                    if (
                        message.content &&
                        'data' in message.content &&
                        message.content.data &&
                        (message.content.data[WIDGET_MIMETYPE] ||
                            ('target_name' in message.content &&
                                message.content.target_name === Identifiers.DefaultCommTarget))
                    ) {
                        if (!this._ipywidgetsVersion) {
                            determineVersionImpl().catch(noop);
                            if (this.session?.kernel) {
                                this.session.kernel.anyMessage.disconnect(anyMessageHandler, this);
                            }
                        }
                    }
                };

            this.session.kernel.anyMessage.connect(anyMessageHandler, this);
        }
    }

    protected async gatherInternalStartupCode(): Promise<string[]> {
        // Gather all of the startup code into a giant string array so we
        // can execute it all at once.
        const result: string[] = [];
        const startupCode = await Promise.all(
            this.startupCodeProviders.sort((a, b) => b.priority - a.priority).map((provider) => provider.getCode(this))
        );
        for (let code of startupCode) {
            result.push(...code);
        }

        // If this is a live kernel, we shouldn't be changing anything by running startup code.
        if (
            isPythonKernelConnection(this.kernelConnectionMetadata) &&
            this.kernelConnectionMetadata.kind !== 'connectToLiveRemoteKernel'
        ) {
            // Set the ipynb file
            const file = getFilePath(this.resourceUri);
            if (file) {
                result.push(`__vsc_ipynb_file__ = "${file.replace(/\\/g, '\\\\')}"`);
            }
            if (!this.kernelSettings.enableExtendedKernelCompletions) {
                result.push(CodeSnippets.DisableJedi);
            }

            // For Python notebook initialize matplotlib
            // Wrap this startup code in try except as it might fail
            result.push(
                ...wrapPythonStartupBlock(
                    this.getMatplotLibInitializeCode(),
                    'Failed to initialize matplotlib startup code. Matplotlib might be missing.'
                )
            );
        }

        return result;
    }

    protected getMatplotLibInitializeCode(): string[] {
        const results: string[] = [];

        if (this.kernelSettings.themeMatplotlibPlots) {
            // We're theming matplotlibs, so we have to setup our default state.
            traceInfoIfCI(`Initialize config for plots for ${getDisplayPath(this.resourceUri || this.uri)}`);

            const matplotInit = CodeSnippets.MatplotLibInit;

            traceVerbose(`Initialize matplotlib for ${getDisplayPath(this.resourceUri || this.uri)}`);
            // Force matplotlib to inline and save the default style. We'll use this later if we
            // get a request to update style
            results.push(...splitLines(matplotInit, { trim: false }));

            // TODO: This must be joined with the previous request (else we send two separate requests unnecessarily).
            const useDark = this.appShell.activeColorTheme.kind === ColorThemeKind.Dark;
            if (!this.kernelSettings.ignoreVscodeTheme) {
                // Reset the matplotlib style based on if dark or not.
                results.push(
                    useDark
                        ? "matplotlib.style.use('dark_background')"
                        : `matplotlib.rcParams.update(${Identifiers.MatplotLibDefaultParams})`
                );
            }
        }

        // Add in SVG to the figure formats if needed
        if (this.kernelSettings.generateSVGPlots) {
            results.push(...splitLines(CodeSnippets.AppendSVGFigureFormat, { trim: false }));
            traceVerbose('Add SVG to matplotlib figure formats');
        }

        return results;
    }

    protected getUserStartupCommands(): string[] {
        // Run any startup commands that we specified. Support the old form too
        let setting = this.kernelSettings.runStartupCommands;

        // Convert to string in case we get an array of startup commands.
        if (Array.isArray(setting)) {
            setting = setting.join(`\n`);
        }

        if (setting) {
            // Cleanup the line feeds. User may have typed them into the settings UI so they will have an extra \\ on the front.
            const cleanedUp = setting.replace(/\\n/g, '\n');
            return splitLines(cleanedUp, { trim: false });
        }
        return [];
    }

    protected async executeSilently(
        session: IKernelSession,
        code: string[],
        errorOptions?: SilentExecutionErrorOptions
    ) {
        if (code.join('').trim().length === 0) {
            return;
        }
        if (!session.kernel) {
            traceVerbose(`Not executing startup as there is no session, code: ${code}`);
            return;
        }
        return executeSilently(session.kernel, code.join('\n'), errorOptions);
    }
}

export class ThirdPartyKernel extends BaseKernel implements IThirdPartyKernel {
    public override get creator(): '3rdPartyExtension' {
        return '3rdPartyExtension';
    }
    constructor(
        uri: Uri,
        resourceUri: Resource,
        kernelConnectionMetadata: Readonly<KernelConnectionMetadata>,
        sessionCreator: IKernelSessionFactory,
        appShell: IApplicationShell,
        kernelSettings: IKernelSettings,
        startupCodeProviders: IStartupCodeProvider[],
        workspaceMemento: Memento
    ) {
        super(
            `3rdPartyKernel_${uuid()}`,
            uri,
            resourceUri,
            kernelConnectionMetadata,
            sessionCreator,
            kernelSettings,
            appShell,
            startupCodeProviders,
            '3rdPartyExtension',
            workspaceMemento
        );
    }
}

/**
 * Represents an active kernel process running on the jupyter (or local) machine.
 */
export class Kernel extends BaseKernel implements IKernel {
    public override get creator(): 'jupyterExtension' {
        return 'jupyterExtension';
    }

    constructor(
        resourceUri: Resource,
        public readonly notebook: NotebookDocument,
        kernelConnectionMetadata: Readonly<KernelConnectionMetadata>,
        sessionCreator: IKernelSessionFactory,
        kernelSettings: IKernelSettings,
        appShell: IApplicationShell,
        public readonly controller: IKernelController,
        startupCodeProviders: IStartupCodeProvider[],
        workspaceMemento: Memento
    ) {
        super(
            uuid(),
            notebook.uri,
            resourceUri,
            kernelConnectionMetadata,
            sessionCreator,
            kernelSettings,
            appShell,
            startupCodeProviders,
            'jupyterExtension',
            workspaceMemento
        );
    }
}

// Wrap a block of python code in try except to make sure hat we have n
function wrapPythonStartupBlock(inputCode: string[], pythonMessage: string): string[] {
    if (!inputCode || inputCode.length === 0) {
        return inputCode;
    }

    // First space in everything
    inputCode = inputCode.map((codeLine) => {
        return `    ${codeLine}`;
    });

    // Add the try except
    inputCode.unshift(`try:`);
    inputCode.push(`except:`, `    print('${pythonMessage}')`);

    return inputCode;
}

/**
 * From the outputs, get the text/plain or stream outputs as a simple string.
 */
export function getPlainTextOrStreamOutput(outputs: nbformat.IOutput[]) {
    if (outputs.length > 0) {
        const data = outputs[0].data;
        if (data && data.hasOwnProperty('text/plain')) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return concatMultilineString((data as any)['text/plain']);
        }
        if (outputs[0].output_type === 'stream') {
            const stream = outputs[0] as nbformat.IStream;
            return concatMultilineString(stream.text);
        }
    }
    return;
}
