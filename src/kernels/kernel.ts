// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';
import * as uuid from 'uuid/v4';
import type * as nbformat from '@jupyterlab/nbformat';
import type { KernelMessage } from '@jupyterlab/services';
import { Observable } from 'rxjs/Observable';
import { ReplaySubject } from 'rxjs/ReplaySubject';
import {
    CancellationTokenSource,
    Event,
    EventEmitter,
    NotebookCell,
    NotebookController,
    NotebookDocument,
    ColorThemeKind,
    Disposable
} from 'vscode';
import { IApplicationShell, IWorkspaceService } from '../client/common/application/types';
import { WrappedError } from '../client/../extension/errors/types';
import { disposeAllDisposables } from '../client/common/helpers';
import { traceInfo, traceInfoIfCI, traceError, traceVerbose, traceWarning } from '../client/common/logger';
import { getDisplayPath } from '../client/common/platform/fs-paths';
import { IFileSystem } from '../client/common/platform/types';
import { IPythonExecutionFactory } from '../client/common/process/types';
import { Resource, IDisposableRegistry, IConfigurationService, IDisposable } from '../client/common/types';
import { Deferred } from '../client/common/utils/async';
import { DataScience } from '../client/common/utils/localize';
import { noop } from '../client/common/utils/misc';
import { StopWatch } from '../client/common/utils/stopWatch';
import { AddRunCellHook } from '../client/datascience/constants';
import { DisplayOptions } from '../client/datascience/displayOptions';
import { CellHashProviderFactory } from '../interactive-window/editor-integration/cellHashProviderFactory';
import { JupyterConnectError } from '../extension/errors/jupyterConnectError';
import { InteractiveWindowView } from '../notebooks/constants';
import { KernelProgressReporter } from '../client/datascience/progress/kernelProgressReporter';
import {
    sendKernelTelemetryEvent,
    trackKernelResourceInformation,
    initializeInteractiveOrNotebookTelemetryBasedOnUserAction
} from '../client/datascience/telemetry/telemetry';
import {
    INotebookProviderConnection,
    KernelSocketInformation,
    INotebook,
    IJupyterSession,
    INotebookProvider,
    IStatusProvider,
    InterruptResult,
    IDisplayOptions
} from '../client/datascience/types';
import { calculateWorkingDirectory } from '../client/datascience/utils';
import { sendTelemetryEvent } from '../client/telemetry';
import { concatMultilineString } from '../datascience-ui/common';
import { Telemetry, Identifiers, CodeSnippets } from '../datascience-ui/common/constants';
import { sleep } from '../test/core';
import { CellOutputDisplayIdTracker } from '../notebooks/execution/cellDisplayIdTracker';
import {
    executeSilently,
    getDisplayNameOrNameOfKernelConnection,
    isPythonKernelConnection,
    sendTelemetryForPythonKernelExecutable
} from './helpers';
import { expandWorkingDir } from './jupyter/jupyterUtils';
import {
    IKernel,
    isLocalConnection,
    isLocalHostConnection,
    KernelConnectionMetadata,
    NotebookCellRunState
} from './types';
import { KernelExecution } from '../notebooks/execution/kernelExecution';
import { traceCellMessage } from '../notebooks/helpers';
import { Cancellation } from '../client/common/cancellation';

export class Kernel implements IKernel {
    /**
     * Used for debugging purposes, ability to uniquely identify kernels.
     */
    public readonly id: string;
    get connection(): INotebookProviderConnection | undefined {
        return this.notebook?.connection;
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
    get onPreExecute(): Event<NotebookCell> {
        return this._onPreExecute.event;
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
        if (this._notebookPromise && !this.notebook) {
            return 'starting';
        }
        return this.notebook?.session?.status ?? (this.isKernelDead ? 'dead' : 'unknown');
    }
    get disposed(): boolean {
        return this._disposed === true || this.notebook?.session.disposed === true;
    }
    get disposing(): boolean {
        return this._disposing === true;
    }
    get kernelSocket(): Observable<KernelSocketInformation | undefined> {
        return this._kernelSocket.asObservable();
    }
    private notebook?: INotebook;
    /**
     * If the session died, then ensure the status is set to `dead`.
     * We need to provide an accurate status.
     * `unknown` is generally used to indicate jupyter kernel hasn't started.
     * If a jupyter kernel dies after it has started, then status is set to `dead`.
     */
    private isKernelDead?: boolean;
    public get session(): IJupyterSession | undefined {
        return this.notebook?.session;
    }
    public get pendingCells() {
        return this.kernelExecution.queue;
    }
    private _disposed?: boolean;
    private _disposing?: boolean;
    private _ignoreNotebookDisposedErrors?: boolean;
    private readonly _kernelSocket = new ReplaySubject<KernelSocketInformation | undefined>();
    private readonly _onStatusChanged = new EventEmitter<KernelMessage.Status>();
    private readonly _onRestarted = new EventEmitter<void>();
    private readonly _onStarted = new EventEmitter<void>();
    private readonly _onDisposed = new EventEmitter<void>();
    private readonly _onPreExecute = new EventEmitter<NotebookCell>();
    private _notebookPromise?: Promise<INotebook>;
    private readonly hookedNotebookForEvents = new WeakSet<INotebook>();
    private eventHooks: ((ev: 'willInterrupt' | 'willRestart') => Promise<void>)[] = [];
    private restarting?: Deferred<void>;
    private readonly kernelExecution: KernelExecution;
    private disposingPromise?: Promise<void>;
    private startCancellation = new CancellationTokenSource();
    private startupUI = new DisplayOptions(true);
    constructor(
        public readonly notebookDocument: NotebookDocument,
        public readonly resourceUri: Resource,
        public readonly kernelConnectionMetadata: Readonly<KernelConnectionMetadata>,
        private readonly notebookProvider: INotebookProvider,
        private readonly disposables: IDisposableRegistry,
        private readonly launchTimeout: number,
        interruptTimeout: number,
        private readonly appShell: IApplicationShell,
        private readonly fs: IFileSystem,
        public readonly controller: NotebookController,
        private readonly configService: IConfigurationService,
        outputTracker: CellOutputDisplayIdTracker,
        private readonly workspaceService: IWorkspaceService,
        readonly cellHashProviderFactory: CellHashProviderFactory,
        private readonly pythonExecutionFactory: IPythonExecutionFactory,
        private statusProvider: IStatusProvider
    ) {
        this.id = `${uuid()}#${kernelConnectionMetadata.id}`;
        this.kernelExecution = new KernelExecution(
            this,
            appShell,
            kernelConnectionMetadata,
            interruptTimeout,
            disposables,
            controller,
            outputTracker,
            cellHashProviderFactory
        );
        this.kernelExecution.onPreExecute((c) => this._onPreExecute.fire(c), this, disposables);
    }
    private perceivedJupyterStartupTelemetryCaptured?: boolean;

    public addEventHook(hook: (event: 'willRestart' | 'willInterrupt') => Promise<void>): void {
        this.eventHooks.push(hook);
    }

    public removeEventHook(hook: (event: 'willRestart' | 'willInterrupt') => Promise<void>): void {
        this.eventHooks = this.eventHooks.filter((h) => h !== hook);
    }

    public async executeCell(cell: NotebookCell): Promise<NotebookCellRunState> {
        traceCellMessage(cell, `kernel.executeCell, ${getDisplayPath(cell.notebook.uri)}`);
        sendKernelTelemetryEvent(this.resourceUri, Telemetry.ExecuteCell);
        const stopWatch = new StopWatch();
        const sessionPromise = this.startNotebook().then((nb) => nb.session);
        const promise = this.kernelExecution.executeCell(sessionPromise, cell);
        this.trackNotebookCellPerceivedColdTime(stopWatch, sessionPromise, promise).catch(noop);
        void promise.then((state) => traceInfo(`Cell ${cell.index} executed with state ${state}`));
        return promise;
    }
    public async executeHidden(code: string): Promise<nbformat.IOutput[]> {
        traceInfoIfCI(`Execute hidden code ${code}`);
        const stopWatch = new StopWatch();
        const sessionPromise = this.startNotebook().then((nb) => nb.session);
        const promise = sessionPromise.then((session) => executeSilently(session, code));
        this.trackNotebookCellPerceivedColdTime(stopWatch, sessionPromise, promise).catch(noop);
        return promise;
    }
    public async start(options?: IDisplayOptions): Promise<void> {
        await this.startNotebook(options);
    }
    public async interrupt(): Promise<void> {
        await Promise.all(this.eventHooks.map((h) => h('willInterrupt')));
        trackKernelResourceInformation(this.resourceUri, { interruptKernel: true });
        if (this.restarting) {
            traceInfo(
                `Interrupt requested & currently restarting ${(
                    this.resourceUri || this.notebookDocument.uri
                ).toString()}`
            );
            await this.restarting.promise;
        }
        traceInfo(`Interrupt requested ${(this.resourceUri || this.notebookDocument.uri).toString()}`);
        this.startCancellation.cancel();
        const interruptResultPromise = this.kernelExecution.interrupt(
            this._notebookPromise?.then((item) => item.session)
        );

        const status = this.statusProvider.set(DataScience.interruptKernelStatus());
        let result: InterruptResult | undefined;
        try {
            traceInfo(`Interrupt requested & sent for ${getDisplayPath(this.notebookDocument.uri)} in notebookEditor.`);
            result = await interruptResultPromise;
            if (result === InterruptResult.TimedOut) {
                const message = DataScience.restartKernelAfterInterruptMessage();
                const yes = DataScience.restartKernelMessageYes();
                const no = DataScience.restartKernelMessageNo();
                const v = await this.appShell.showInformationMessage(message, { modal: true }, yes, no);
                if (v === yes) {
                    await this.restart();
                }
            }
        } finally {
            status.dispose();
        }
    }
    public async dispose(): Promise<void> {
        traceInfoIfCI(`Dispose Kernel ${getDisplayPath(this.notebookDocument.uri)}`);
        this._disposing = true;
        if (this.disposingPromise) {
            return this.disposingPromise;
        }
        this._ignoreNotebookDisposedErrors = true;
        this.startCancellation.cancel();
        const disposeImpl = async () => {
            traceInfo(`Dispose kernel ${(this.resourceUri || this.notebookDocument.uri).toString()}`);
            this.restarting = undefined;
            const promises: Promise<void>[] = [];
            promises.push(this.kernelExecution.cancel());
            this.notebook = this.notebook
                ? this.notebook
                : this._notebookPromise
                ? await this._notebookPromise
                : undefined;
            this._notebookPromise = undefined;
            if (this.notebook) {
                promises.push(this.notebook.session.dispose().catch(noop));
                this.notebook = undefined;
            }
            this._disposed = true;
            this._onDisposed.fire();
            this._onStatusChanged.fire('dead');
            this.kernelExecution.dispose();
            await Promise.all(promises);
        };
        this.disposingPromise = disposeImpl();
        await this.disposingPromise;
    }
    public async restart(): Promise<void> {
        if (this.restarting) {
            return this.restarting.promise;
        }
        await Promise.all(this.eventHooks.map((h) => h('willRestart')));
        traceInfo(`Restart requested ${this.notebookDocument.uri}`);
        this.startCancellation.cancel();
        // Set our status
        const status = this.statusProvider.set(DataScience.restartingKernelStatus().format(''));
        const progress = KernelProgressReporter.createProgressReporter(
            this.resourceUri,
            DataScience.restartingKernelStatus().format(
                `: ${getDisplayNameOrNameOfKernelConnection(this.kernelConnectionMetadata)}`
            )
        );

        const stopWatch = new StopWatch();
        try {
            // If the notebook died, then start a new notebook.
            await (this._notebookPromise
                ? this.kernelExecution.restart(this._notebookPromise?.then((item) => item.session))
                : this.start(new DisplayOptions(false)));
            traceInfoIfCI(`Restarted ${getDisplayPath(this.notebookDocument.uri)}`);
            sendKernelTelemetryEvent(this.resourceUri, Telemetry.NotebookRestart, stopWatch.elapsedTime);
        } catch (ex) {
            traceError(`Restart failed ${getDisplayPath(this.notebookDocument.uri)}`, ex);
            this._ignoreNotebookDisposedErrors = true;
            // If restart fails, kill the associated notebook.
            const notebook = this.notebook;
            this.notebook = undefined;
            this._notebookPromise = undefined;
            this.restarting = undefined;
            // If we get a kernel promise failure, then restarting timed out. Just shutdown and restart the entire server.
            // Note, this code might not be necessary, as such an error is thrown only when interrupting a kernel times out.
            sendKernelTelemetryEvent(this.resourceUri, Telemetry.NotebookRestart, stopWatch.elapsedTime, undefined, ex);
            await notebook?.session.dispose().catch(noop);
            this._ignoreNotebookDisposedErrors = false;
            throw ex;
        } finally {
            status.dispose();
            progress.dispose();
        }

        // Interactive window needs a restart sys info
        await this.initializeAfterStart(this.notebook, this.notebookDocument);
        traceInfoIfCI(`Initialized after restart ${this.notebookDocument.uri}`);

        // Indicate a restart occurred if it succeeds
        this._onRestarted.fire();
        traceInfoIfCI(`Event fired after restart ${this.notebookDocument.uri}`);
    }
    private async trackNotebookCellPerceivedColdTime(
        stopWatch: StopWatch,
        started: Promise<unknown>,
        executionPromise: Promise<unknown>
    ): Promise<void> {
        if (this.perceivedJupyterStartupTelemetryCaptured) {
            return;
        }
        const notebook = await started;
        if (!notebook) {
            return;
        }
        // Setup telemetry
        if (!this.perceivedJupyterStartupTelemetryCaptured) {
            this.perceivedJupyterStartupTelemetryCaptured = true;
            sendTelemetryEvent(Telemetry.PerceivedJupyterStartupNotebook, stopWatch.elapsedTime);
            executionPromise.finally(() =>
                sendTelemetryEvent(Telemetry.StartExecuteNotebookCellPerceivedCold, stopWatch.elapsedTime)
            );
        }
    }
    private async startNotebook(options: IDisplayOptions = new DisplayOptions(false)): Promise<INotebook> {
        this._startedAtLeastOnce = true;
        traceInfoIfCI(
            `Start Notebook (options.disableUI=${options.disableUI}) for ${getDisplayPath(this.notebookDocument.uri)}.`
        );
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
            initializeInteractiveOrNotebookTelemetryBasedOnUserAction(this.resourceUri, this.kernelConnectionMetadata);
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
                    );
                },
                this,
                this.disposables
            );
        }
        if (this.restarting) {
            await this.restarting.promise;
        }
        if (!this._notebookPromise) {
            // Don't create a new one unnecessarily.
            if (this.startCancellation.token.isCancellationRequested) {
                traceInfoIfCI(`Create new cancellation token for ${getDisplayPath(this.notebookDocument.uri)}`);
                this.startCancellation = new CancellationTokenSource();
            }
            this._notebookPromise = this.createNotebook(new StopWatch()).catch((ex) => {
                traceInfoIfCI(
                    `Failed to create Notebook in Kernel.startNotebook for ${getDisplayPath(this.notebookDocument.uri)}`
                );
                // If we fail also clear the promise.
                this.startCancellation.cancel();
                this._notebookPromise = undefined;
                throw ex;
            });
        }
        return this._notebookPromise;
    }

    private async createNotebook(stopWatch: StopWatch): Promise<INotebook> {
        let disposables: Disposable[] = [];
        try {
            // No need to block kernel startup on UI updates.
            traceInfo(
                `Starting Notebook in kernel.ts id = ${this.kernelConnectionMetadata.id} for ${getDisplayPath(
                    this.notebookDocument.uri
                )}`
            );
            this.createProgressIndicator(disposables);
            this.isKernelDead = false;
            this._onStatusChanged.fire('starting');
            const notebook = await this.notebookProvider.createNotebook({
                document: this.notebookDocument,
                resource: this.resourceUri,
                ui: this.startupUI,
                kernelConnection: this.kernelConnectionMetadata,
                token: this.startCancellation.token
            });
            Cancellation.throwIfCanceled(this.startCancellation.token);
            if (!notebook) {
                // This is an unlikely case.
                // getOrCreateNotebook would return undefined only if getOnly = true (an issue with typings).
                throw new Error('Kernel has not been started');
            }
            await this.initializeAfterStart(notebook, this.notebookDocument);

            sendKernelTelemetryEvent(
                this.resourceUri,
                Telemetry.PerceivedJupyterStartupNotebook,
                stopWatch.elapsedTime
            );
            this.notebook = notebook;
            this._onStarted.fire();
            return notebook;
        } catch (ex) {
            // Don't log errors if UI is disabled (e.g. auto starting a kernel)
            // Else we just pollute the logs with lots of noise.
            if (this.startupUI.disableUI) {
                traceVerbose(`failed to create INotebook in kernel, UI Disabled = ${this.startupUI.disableUI}`, ex);
            } else {
                traceError(`failed to create INotebook in kernel, UI Disabled = ${this.startupUI.disableUI}`, ex);
            }
            Cancellation.throwIfCanceled(this.startCancellation.token);
            if (ex instanceof JupyterConnectError) {
                throw ex;
            }
            // Provide a user friendly message in case `ex` is some error thats not throw by us.
            const message = DataScience.sessionStartFailedWithKernel().format(
                getDisplayNameOrNameOfKernelConnection(this.kernelConnectionMetadata)
            );
            throw WrappedError.from(message + ' ' + ('message' in ex ? ex.message : ex.toString()), ex);
        } finally {
            disposeAllDisposables(disposables);
        }
    }

    private createProgressIndicator(disposables: IDisposable[]) {
        // Even if we're not supposed to display the progress indicator,
        // create it and keep it hidden.
        const progressReporter = KernelProgressReporter.createProgressReporter(
            this.resourceUri,
            DataScience.connectingToKernel().format(
                getDisplayNameOrNameOfKernelConnection(this.kernelConnectionMetadata)
            ),
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

    private async initializeAfterStart(notebook: INotebook | undefined, notebookDocument: NotebookDocument) {
        traceVerbose(`Started running kernel initialization for ${getDisplayPath(this.notebookDocument.uri)}`);
        if (!notebook) {
            traceVerbose('Not running kernel initialization');
            return;
        }
        if (!this.hookedNotebookForEvents.has(notebook)) {
            this.hookedNotebookForEvents.add(notebook);
            notebook.session.kernelSocket.subscribe(this._kernelSocket);
            notebook.session.onDidDispose(() => {
                traceInfoIfCI(
                    `Kernel got disposed as a result of notebook.onDisposed ${(
                        this.resourceUri || this.notebookDocument.uri
                    ).toString()}`
                );
                // Ignore when notebook is disposed as a result of failed restarts.
                if (!this._ignoreNotebookDisposedErrors) {
                    traceInfo(
                        `Kernel got disposed as a result of notebook.onDisposed ${(
                            this.resourceUri || this.notebookDocument.uri
                        ).toString()} & _ignoreNotebookDisposedErrors = false.`
                    );
                    const isActiveNotebookDead = this.notebook === notebook;

                    this._notebookPromise = undefined;
                    this.notebook = undefined;

                    // If the active notebook died, then kernel is dead.
                    if (isActiveNotebookDead) {
                        this.isKernelDead = true;
                        this._onStatusChanged.fire('dead');
                    }
                }
            });
            const statusChangeHandler = (status: KernelMessage.Status) => {
                traceVerbose(`IKernel Status change to ${status}`);
                this._onStatusChanged.fire(status);
            };
            this.disposables.push(notebook.session.onSessionStatusChanged(statusChangeHandler));
        }
        if (isPythonKernelConnection(this.kernelConnectionMetadata)) {
            // So that we don't have problems with ipywidgets, always register the default ipywidgets comm target.
            // Restart sessions and retries might make this hard to do correctly otherwise.
            notebook.session.registerCommTarget(Identifiers.DefaultCommTarget, noop);

            // Request completions to warm up the completion engine.
            this.requestEmptyCompletions();

            if (isLocalConnection(this.kernelConnectionMetadata)) {
                await sendTelemetryForPythonKernelExecutable(
                    this,
                    this.resourceUri,
                    this.kernelConnectionMetadata,
                    this.pythonExecutionFactory
                );
            }
        }

        // If this is a live kernel, we shouldn't be changing anything by running startup code.
        if (this.kernelConnectionMetadata.kind !== 'connectToLiveKernel') {
            // Gather all of the startup code at one time and execute as one cell
            const startupCode = await this.gatherInternalStartupCode(notebookDocument);
            await this.executeSilently(notebook, startupCode, {
                traceErrors: true,
                traceErrorsMessage: 'Error executing jupyter extension internal startup code',
                telemetryName: Telemetry.KernelStartupCodeFailure
            });

            // Run user specified startup commands
            await this.executeSilently(notebook, this.getUserStartupCommands(), {
                traceErrors: true,
                traceErrorsMessage: 'Error executing user defined startup code',
                telemetryName: Telemetry.UserStartupCodeFailure
            });
        }

        // Then request our kernel info (indicates kernel is ready to go)
        try {
            traceVerbose('Requesting Kernel info');

            const promises: Promise<
                | KernelMessage.IReplyErrorContent
                | KernelMessage.IReplyAbortContent
                | KernelMessage.IInfoReply
                | undefined
            >[] = [];

            const defaultResponse: KernelMessage.IInfoReply = {
                banner: '',
                help_links: [],
                implementation: '',
                implementation_version: '',
                language_info: { name: '', version: '' },
                protocol_version: '',
                status: 'ok'
            };
            promises.push(notebook.session.requestKernelInfo().then((item) => item?.content));
            // If this doesn't complete in 5 seconds for remote kernels, assume the kernel is busy & provide some default content.
            if (this.kernelConnectionMetadata.kind === 'connectToLiveKernel') {
                promises.push(sleep(5_000).then(() => defaultResponse));
            }
            const content = await Promise.race(promises);
            if (content === defaultResponse) {
                traceWarning('Failed to Kernel info in a timely manner, defaulting to empty info!');
            } else {
                traceVerbose('Got Kernel info');
            }
            this._info = content;
        } catch (ex) {
            traceWarning('Failed to request KernelInfo', ex);
        }
        if (this.kernelConnectionMetadata.kind !== 'connectToLiveKernel') {
            traceVerbose('End running kernel initialization, now waiting for idle');
            await notebook.session.waitForIdle(this.launchTimeout);
            traceVerbose('End running kernel initialization, session is idle');
        }
    }

    private async gatherInternalStartupCode(notebookDocument: NotebookDocument): Promise<string[]> {
        // Gather all of the startup code into a giant string array so we
        // can execute it all at once.
        const result: string[] = [];

        if (isPythonKernelConnection(this.kernelConnectionMetadata)) {
            const [changeDirScripts, debugCellScripts] = await Promise.all([
                // Change our initial directory and path
                this.getUpdateWorkingDirectoryAndPathCode(this.resourceUri),
                // Initialize debug cell support.
                // (IPYKERNEL_CELL_NAME has to be set on every cell execution, but we can't execute a cell to change it)
                this.getDebugCellHook(notebookDocument)
            ]);

            // Have our debug cell script run first for safety
            result.push(...debugCellScripts);

            if (isLocalConnection(this.kernelConnectionMetadata)) {
                // Append the global site_packages to the kernel's sys.path
                // For more details see here https://github.com/microsoft/vscode-jupyter/issues/8553#issuecomment-997144591
                // Basically all we're doing here is ensuring the global site_packages is at the bottom of sys.path and not somewhere halfway down.
                // Note: We have excluded site_pacakges via the env variable `PYTHONNOUSERSITE`
                result.push(...CodeSnippets.AppendSitePackages.splitLines({ trim: false }));
            }

            result.push(...changeDirScripts);

            // Set the ipynb file
            const file = this.resourceUri?.fsPath;
            if (file) {
                result.push(`__vsc_ipynb_file__ = "${file.replace(/\\/g, '\\\\')}"`);
            }
            result.push(CodeSnippets.DisableJedi);

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

    /**
     * Do not wait for completions,
     * If the completions request crashes then we don't get a response for this request,
     * Hence we end up waiting indefinitely.
     * https://github.com/microsoft/vscode-jupyter/issues/9014
     */
    private requestEmptyCompletions() {
        void this.session?.requestComplete({
            code: '__file__.',
            cursor_pos: 9
        });
    }

    private getMatplotLibInitializeCode(): string[] {
        const results: string[] = [];

        const settings = this.configService.getSettings(this.resourceUri);
        if (settings && settings.themeMatplotlibPlots) {
            // We're theming matplotlibs, so we have to setup our default state.
            traceInfoIfCI(
                `Initialize config for plots for ${(this.resourceUri || this.notebookDocument.uri).toString()}`
            );

            const matplotInit = CodeSnippets.MatplotLibInit;

            traceInfo(`Initialize matplotlib for ${(this.resourceUri || this.notebookDocument.uri).toString()}`);
            // Force matplotlib to inline and save the default style. We'll use this later if we
            // get a request to update style
            results.push(...matplotInit.splitLines({ trim: false }));

            // TODO: This must be joined with the previous request (else we send two seprate requests unnecessarily).
            const useDark = this.appShell.activeColorTheme.kind === ColorThemeKind.Dark;
            if (!settings.ignoreVscodeTheme) {
                // Reset the matplotlib style based on if dark or not.
                results.push(
                    useDark
                        ? "matplotlib.style.use('dark_background')"
                        : `matplotlib.rcParams.update(${Identifiers.MatplotLibDefaultParams})`
                );
            }
        }

        // Add in SVG to the figure formats if needed
        if (settings.generateSVGPlots) {
            results.push(...CodeSnippets.AppendSVGFigureFormat.splitLines({ trim: false }));
            traceInfo('Add SVG to matplotlib figure formats');
        }

        return results;
    }

    private async getDebugCellHook(notebookDocument: NotebookDocument): Promise<string[]> {
        // Only do this for interactive windows. IPYKERNEL_CELL_NAME is set other ways in
        // notebooks
        if (notebookDocument.notebookType === InteractiveWindowView) {
            // If using ipykernel 6, we need to set the IPYKERNEL_CELL_NAME so that
            // debugging can work. However this code is harmless for IPYKERNEL 5 so just always do it
            if (await this.fs.localFileExists(AddRunCellHook.ScriptPath)) {
                const fileContents = await this.fs.readLocalFile(AddRunCellHook.ScriptPath);
                return fileContents.splitLines({ trim: false });
            }
            traceError(`Cannot run non-existant script file: ${AddRunCellHook.ScriptPath}`);
        }
        return [];
    }

    private getUserStartupCommands(): string[] {
        const settings = this.configService.getSettings(this.resourceUri);
        // Run any startup commands that we specified. Support the old form too
        let setting = settings.runStartupCommands;

        // Convert to string in case we get an array of startup commands.
        if (Array.isArray(setting)) {
            setting = setting.join(`\n`);
        }

        if (setting) {
            // Cleanup the line feeds. User may have typed them into the settings UI so they will have an extra \\ on the front.
            const cleanedUp = setting.replace(/\\n/g, '\n');
            return cleanedUp.splitLines({ trim: false });
        }
        return [];
    }

    private async getUpdateWorkingDirectoryAndPathCode(launchingFile?: Resource): Promise<string[]> {
        if (
            (isLocalConnection(this.kernelConnectionMetadata) ||
                isLocalHostConnection(this.kernelConnectionMetadata)) &&
            this.kernelConnectionMetadata.kind !== 'connectToLiveKernel' // Skip for live kernel. Don't change current directory on a kernel that's already running
        ) {
            let suggestedDir = await calculateWorkingDirectory(
                this.configService,
                this.workspaceService,
                this.fs,
                launchingFile
            );
            if (suggestedDir && (await this.fs.localDirectoryExists(suggestedDir))) {
                traceInfo('UpdateWorkingDirectoryAndPath in Kernel');
                // We should use the launch info directory. It trumps the possible dir
                return this.getChangeDirectoryCode(suggestedDir);
            } else if (launchingFile && (await this.fs.localFileExists(launchingFile.fsPath))) {
                // Combine the working directory with this file if possible.
                suggestedDir = expandWorkingDir(suggestedDir, launchingFile.fsPath, this.workspaceService);
                if (suggestedDir && (await this.fs.localDirectoryExists(suggestedDir))) {
                    traceInfo('UpdateWorkingDirectoryAndPath in Kernel');
                    return this.getChangeDirectoryCode(suggestedDir);
                }
            }
        }
        return [];
    }

    // Update both current working directory and sys.path with the desired directory
    private getChangeDirectoryCode(directory: string): string[] {
        if (
            (isLocalConnection(this.kernelConnectionMetadata) ||
                isLocalHostConnection(this.kernelConnectionMetadata)) &&
            isPythonKernelConnection(this.kernelConnectionMetadata)
        ) {
            return CodeSnippets.UpdateCWDAndPath.format(directory).splitLines({ trim: false });
        }
        return [];
    }

    private async executeSilently(
        notebook: INotebook | undefined,
        code: string[],
        errorOptions?: SilentExecutionErrorOptions
    ) {
        if (!notebook || code.join('').trim().length === 0) {
            traceVerbose(`Not executing startup notebook: ${notebook ? 'Object' : 'undefined'}, code: ${code}`);
            return;
        }
        await executeSilently(notebook.session, code.join('\n'), errorOptions);
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

// Options for error reporting from kernel silent execution
export type SilentExecutionErrorOptions = {
    // Setting this will log jupyter errors from silent execution as errors as opposed to warnings
    traceErrors?: boolean;
    // This optional message will be displayed as a prefix for the error or warning message
    traceErrorsMessage?: string;
    // Setting this will log telemetry on the given name
    telemetryName?: Telemetry;
};
