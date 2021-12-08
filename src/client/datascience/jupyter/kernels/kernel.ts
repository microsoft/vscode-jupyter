// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';
import type { KernelMessage } from '@jupyterlab/services';
import { Observable } from 'rxjs/Observable';
import { Subject } from 'rxjs/Subject';
import {
    CancellationTokenSource,
    Event,
    EventEmitter,
    NotebookCell,
    NotebookCellData,
    NotebookCellKind,
    NotebookController,
    NotebookDocument,
    NotebookRange,
    Range,
    ColorThemeKind
} from 'vscode';
import { IApplicationShell, ICommandManager, IWorkspaceService } from '../../../common/application/types';
import { traceError, traceInfo, traceInfoIfCI, traceWarning } from '../../../common/logger';
import { IFileSystem } from '../../../common/platform/types';
import { IConfigurationService, IDisposable, IDisposableRegistry, Resource } from '../../../common/types';
import { noop } from '../../../common/utils/misc';
import { StopWatch } from '../../../common/utils/stopWatch';
import { sendTelemetryEvent } from '../../../telemetry';
import { CodeSnippets, Commands, Identifiers, Telemetry } from '../../constants';
import {
    initializeInteractiveOrNotebookTelemetryBasedOnUserAction,
    sendKernelTelemetryEvent,
    trackKernelResourceInformation
} from '../../telemetry/telemetry';
import {
    IDataScienceErrorHandler,
    IJupyterConnection,
    IJupyterServerUriStorage,
    IJupyterSession,
    INotebook,
    INotebookProvider,
    INotebookProviderConnection,
    InterruptResult,
    IStatusProvider,
    KernelSocketInformation
} from '../../types';
import {
    getDisplayNameOrNameOfKernelConnection,
    getSysInfoReasonHeader,
    isPythonKernelConnection,
    sendTelemetryForPythonKernelExecutable
} from './helpers';
import { KernelExecution } from './kernelExecution';
import { IKernel, isLocalConnection, KernelConnectionMetadata, NotebookCellRunState } from './types';
import { SysInfoReason } from '../../interactive-common/interactiveWindowTypes';
import { MARKDOWN_LANGUAGE } from '../../../common/constants';
import { InteractiveWindowView } from '../../notebook/constants';
import { chainWithPendingUpdates } from '../../notebook/helpers/notebookUpdater';
import { DataScience } from '../../../common/utils/localize';
import { CellOutputDisplayIdTracker } from './cellDisplayIdTracker';
import { calculateWorkingDirectory } from '../../utils';
import { expandWorkingDir } from '../jupyterUtils';
import type * as nbformat from '@jupyterlab/nbformat';
import { concatMultilineString } from '../../../../datascience-ui/common';
import { CellHashProviderFactory } from '../../editor-integration/cellHashProviderFactory';
import { IPythonExecutionFactory } from '../../../common/process/types';
import { INotebookControllerManager } from '../../notebook/types';
import { getResourceType } from '../../common';
import { Deferred } from '../../../common/utils/async';
import { getDisplayPath } from '../../../common/platform/fs-paths';
import { WrappedError } from '../../../common/errors/types';
import { DisplayOptions } from '../../displayOptions';
import { JupyterConnectError } from '../../errors/jupyterConnectError';
import { IPythonExtensionChecker } from '../../../api/types';
import { KernelProgressReporter } from '../../progress/kernelProgressReporter';
import { disposeAllDisposables } from '../../../common/helpers';

export class Kernel implements IKernel {
    get connection(): INotebookProviderConnection | undefined {
        return this.notebook?.connection;
    }
    get onStatusChanged(): Event<KernelMessage.Status> {
        return this._onStatusChanged.event;
    }
    get onRestarted(): Event<void> {
        return this._onRestarted.event;
    }
    get onWillRestart(): Event<void> {
        return this._onWillRestart.event;
    }
    get onWillInterrupt(): Event<void> {
        return this._onWillInterrupt.event;
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
    private _info?: KernelMessage.IInfoReplyMsg['content'];
    get info(): KernelMessage.IInfoReplyMsg['content'] | undefined {
        return this._info;
    }
    get status(): KernelMessage.Status {
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
    public get hasPendingCells() {
        return this.kernelExecution.queue.length > 0;
    }
    private _disposed?: boolean;
    private _disposing?: boolean;
    private _ignoreNotebookDisposedErrors?: boolean;
    private readonly _kernelSocket = new Subject<KernelSocketInformation | undefined>();
    private readonly _onStatusChanged = new EventEmitter<KernelMessage.Status>();
    private readonly _onRestarted = new EventEmitter<void>();
    private readonly _onWillRestart = new EventEmitter<void>();
    private readonly _onWillInterrupt = new EventEmitter<void>();
    private readonly _onStarted = new EventEmitter<void>();
    private readonly _onDisposed = new EventEmitter<void>();
    private readonly _onPreExecute = new EventEmitter<NotebookCell>();
    private _notebookPromise?: Promise<INotebook>;
    private readonly hookedNotebookForEvents = new WeakSet<INotebook>();
    private restarting?: Deferred<void>;
    private readonly kernelExecution: KernelExecution;
    private disposingPromise?: Promise<void>;
    private isPromptingForRestart?: Promise<boolean>;
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
        private readonly errorHandler: IDataScienceErrorHandler,
        private readonly appShell: IApplicationShell,
        private readonly fs: IFileSystem,
        private readonly serverStorage: IJupyterServerUriStorage,
        controller: NotebookController,
        private readonly configService: IConfigurationService,
        outputTracker: CellOutputDisplayIdTracker,
        private readonly workspaceService: IWorkspaceService,
        readonly cellHashProviderFactory: CellHashProviderFactory,
        private readonly pythonExecutionFactory: IPythonExecutionFactory,
        notebookControllerManager: INotebookControllerManager,
        private statusProvider: IStatusProvider,
        private commandManager: ICommandManager,
        pythonChecker: IPythonExtensionChecker
    ) {
        this.kernelExecution = new KernelExecution(
            this,
            errorHandler,
            appShell,
            kernelConnectionMetadata,
            interruptTimeout,
            disposables,
            controller,
            outputTracker,
            cellHashProviderFactory
        );
        this.kernelExecution.onPreExecute((c) => this._onPreExecute.fire(c), this, disposables);
        const isPreferredKernel =
            getResourceType(resourceUri) === 'notebook'
                ? notebookControllerManager.getPreferredNotebookController(this.notebookDocument)?.controller ===
                  controller
                : undefined;
        if (pythonChecker.isPythonExtensionInstalled) {
            trackKernelResourceInformation(resourceUri, {
                kernelConnection: kernelConnectionMetadata,
                isPreferredKernel
            });
        }
    }
    private perceivedJupyterStartupTelemetryCaptured?: boolean;
    public async executeCell(cell: NotebookCell): Promise<NotebookCellRunState> {
        // If this kernel is still active & status is dead or dying, then notify the user of this dead kernel.
        if ((this.status === 'terminating' || this.status === 'dead') && !this.disposed && !this.disposing) {
            const restartedKernel = await this.notifyAndRestartDeadKernel();
            if (!restartedKernel) {
                traceInfo(`Cell ${cell.index} executed with state ${NotebookCellRunState.Error} due to kernel state.`);
                return NotebookCellRunState.Error;
            }
        }

        sendKernelTelemetryEvent(this.resourceUri, Telemetry.ExecuteCell);
        const stopWatch = new StopWatch();
        const sessionPromise = this.startNotebook().then((nb) => nb.session);
        const promise = this.kernelExecution.executeCell(sessionPromise, cell);
        this.trackNotebookCellPerceivedColdTime(stopWatch, sessionPromise, promise).catch(noop);
        void promise.then((state) => traceInfo(`Cell ${cell.index} executed with state ${state}`));
        return promise;
    }
    public async executeHidden(code: string): Promise<nbformat.IOutput[]> {
        const stopWatch = new StopWatch();
        const sessionPromise = this.startNotebook().then((nb) => nb.session);
        const promise = sessionPromise.then((session) => executeSilently(session, code));
        this.trackNotebookCellPerceivedColdTime(stopWatch, sessionPromise, promise).catch(noop);
        return promise;
    }
    public async start(options?: { disableUI?: boolean }): Promise<void> {
        await this.startNotebook(options);
    }
    public async interrupt(): Promise<void> {
        this._onWillInterrupt.fire();
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

        let errorContext: 'interrupt' | 'restart' = 'interrupt';
        let result: InterruptResult | undefined;
        try {
            try {
                traceInfo(
                    `Interrupt requested & sent for ${getDisplayPath(this.notebookDocument.uri)} in notebookEditor.`
                );
                result = await interruptResultPromise;
            } catch (err) {
                traceError('Failed to interrupt kernel', err);
                void this.errorHandler.handleKernelError(
                    err,
                    errorContext,
                    this.kernelConnectionMetadata,
                    this.resourceUri
                );
            }
            if (result === InterruptResult.TimedOut) {
                const message = DataScience.restartKernelAfterInterruptMessage();
                const yes = DataScience.restartKernelMessageYes();
                const no = DataScience.restartKernelMessageNo();
                const v = await this.appShell.showInformationMessage(message, { modal: true }, yes, no);
                if (v === yes) {
                    errorContext = 'restart';
                    await this.restart();
                }
            }
        } finally {
            status.dispose();
        }
    }
    public async dispose(): Promise<void> {
        this._disposing = true;
        if (this.disposingPromise) {
            return this.disposingPromise;
        }
        this._ignoreNotebookDisposedErrors = true;
        this.startCancellation.cancel();
        const disposeImpl = async () => {
            traceInfo(`Dispose kernel ${(this.resourceUri || this.notebookDocument.uri).toString()}`);
            this.restarting = undefined;
            this.notebook = this.notebook
                ? this.notebook
                : this._notebookPromise
                ? await this._notebookPromise
                : undefined;
            this._notebookPromise = undefined;
            const promises: Promise<void>[] = [];
            if (this.notebook) {
                promises.push(this.notebook.session.dispose().catch(noop));
                this.notebook = undefined;
                this._disposed = true;
                this._onDisposed.fire();
                this._onStatusChanged.fire('dead');
            }
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
        this._onWillRestart.fire();
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
                : this.start({ disableUI: false }));
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
            void this.errorHandler.handleKernelError(ex, 'restart', this.kernelConnectionMetadata, this.resourceUri);
            throw ex;
        } finally {
            status.dispose();
            progress.dispose();
        }

        // Interactive window needs a restart sys info
        await this.initializeAfterStart(SysInfoReason.Restart, this.notebookDocument);
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
    private async startNotebook(options: { disableUI?: boolean } = { disableUI: false }): Promise<INotebook> {
        if (!options.disableUI) {
            this.startupUI.disableUI = false;
        }

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
            this.startCancellation = new CancellationTokenSource();
            this._notebookPromise = new Promise<INotebook>(async (resolve, reject) => {
                const stopWatch = new StopWatch();
                const disposables: IDisposable[] = [];
                this.createProgressIndicator(disposables);
                try {
                    try {
                        // No need to block kernel startup on UI updates.
                        const placeholderCellPromise = this.populateStartKernelInfoForInteractive(
                            this.notebookDocument,
                            this.kernelConnectionMetadata
                        );
                        traceInfo(`Starting Notebook in kernel.ts id = ${this.kernelConnectionMetadata.id}`);
                        this.isKernelDead = false;
                        this.notebook = await this.notebookProvider.createNotebook({
                            document: this.notebookDocument,
                            resource: this.resourceUri,
                            ui: this.startupUI,
                            kernelConnection: this.kernelConnectionMetadata,
                            token: this.startCancellation.token
                        });
                        if (!this.notebook) {
                            // This is an unlikely case.
                            // getOrCreateNotebook would return undefined only if getOnly = true (an issue with typings).
                            throw new Error('Kernel has not been started');
                        }
                        await this.initializeAfterStart(
                            SysInfoReason.Start,
                            this.notebookDocument,
                            placeholderCellPromise
                        );
                    } catch (ex) {
                        traceError(
                            `failed to create INotebook in kernel, UI Disabled = ${this.startupUI.disableUI}`,
                            ex
                        );
                        if (ex instanceof JupyterConnectError) {
                            throw ex;
                        }
                        // Provide a user friendly message in case `ex` is some error thats not throw by us.
                        const message = DataScience.sessionStartFailedWithKernel().format(
                            getDisplayNameOrNameOfKernelConnection(this.kernelConnectionMetadata)
                        );
                        throw WrappedError.from(message + ' ' + ('message' in ex ? ex.message : ex.toString()), ex);
                    }
                    sendKernelTelemetryEvent(
                        this.resourceUri,
                        Telemetry.PerceivedJupyterStartupNotebook,
                        stopWatch.elapsedTime
                    );
                    if (this.notebook?.connection) {
                        this.updateRemoteUriList(this.notebook.connection).catch(noop);
                    }
                    resolve(this.notebook);
                    this._onStarted.fire();
                    disposeAllDisposables(disposables);
                } catch (ex) {
                    disposeAllDisposables(disposables);
                    sendKernelTelemetryEvent(
                        this.resourceUri,
                        Telemetry.NotebookStart,
                        stopWatch.elapsedTime,
                        undefined,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        ex as any
                    );
                    if (this.startupUI.disableUI) {
                        sendTelemetryEvent(Telemetry.KernelStartFailedAndUIDisabled);
                    } else if (this._disposing) {
                        // If the kernel was killed for any reason, then no point displaying
                        // errors about startup failures.
                        traceWarning(`Ignoring kernel startup failure as kernel was disposed`, ex);
                    } else {
                        const cellForErrorDisplay = this.kernelExecution.queue.length
                            ? this.kernelExecution.queue[0]
                            : undefined;
                        void this.errorHandler.handleKernelError(
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            ex as any,
                            'start',
                            this.kernelConnectionMetadata,
                            this.resourceUri,
                            cellForErrorDisplay
                        ); // Just a notification, so don't await this
                    }
                    traceError(`failed to start INotebook in kernel, UI Disabled = ${this.startupUI.disableUI}`, ex);
                    this.startCancellation.cancel();
                    this._notebookPromise = undefined;
                    reject(ex);
                }
            });
        }
        return this._notebookPromise;
    }
    private createProgressIndicator(disposables: IDisposable[]) {
        if (this.startupUI.disableUI) {
            this.startupUI.onDidChangeDisableUI(
                () => {
                    if (this.disposing || this.disposed || this.startupUI.disableUI) {
                        return;
                    }
                    disposables.push(
                        KernelProgressReporter.createProgressReporter(
                            this.resourceUri,
                            DataScience.connectingToKernel().format(
                                getDisplayNameOrNameOfKernelConnection(this.kernelConnectionMetadata)
                            )
                        )
                    );
                },
                this,
                disposables
            );
        } else {
            disposables.push(
                KernelProgressReporter.createProgressReporter(
                    this.resourceUri,
                    DataScience.connectingToKernel().format(
                        getDisplayNameOrNameOfKernelConnection(this.kernelConnectionMetadata)
                    )
                )
            );
        }
    }

    private async updateRemoteUriList(serverConnection: INotebookProviderConnection) {
        if (isLocalConnection(this.kernelConnectionMetadata)) {
            return;
        }
        const remoteConnection = serverConnection as IJupyterConnection;
        // Log this remote URI into our MRU list
        await this.serverStorage.addToUriList(
            remoteConnection.url || serverConnection.displayName,
            Date.now(),
            serverConnection.displayName
        );
    }

    private async populateStartKernelInfoForInteractive(
        notebookDocument: NotebookDocument,
        kernelConnection: KernelConnectionMetadata
    ) {
        if (notebookDocument.notebookType === InteractiveWindowView) {
            // add fake sys info
            await chainWithPendingUpdates(notebookDocument, (edit) => {
                const markdownCell = new NotebookCellData(
                    NotebookCellKind.Markup,
                    kernelConnection.interpreter?.displayName
                        ? DataScience.startingNewKernelCustomHeader().format(kernelConnection.interpreter?.displayName)
                        : DataScience.startingNewKernelHeader(),
                    MARKDOWN_LANGUAGE
                );
                markdownCell.metadata = { isInteractiveWindowMessageCell: true, isPlaceholder: true };
                edit.replaceNotebookCells(
                    notebookDocument.uri,
                    new NotebookRange(notebookDocument.cellCount, notebookDocument.cellCount),
                    [markdownCell]
                );
            });
            // This should be the cell we just inserted into the document
            return notebookDocument.cellAt(notebookDocument.cellCount - 1);
        }
    }
    private async notifyAndRestartDeadKernel(): Promise<boolean> {
        if (this.isPromptingForRestart) {
            return this.isPromptingForRestart;
        }

        const checkWhetherToRestart = async () => {
            const selection = await this.appShell.showErrorMessage(
                DataScience.cannotRunCellKernelIsDead().format(
                    getDisplayNameOrNameOfKernelConnection(this.kernelConnectionMetadata)
                ),
                { modal: true },
                DataScience.showJupyterLogs(),
                DataScience.restartKernel()
            );
            let restartedKernel = false;
            switch (selection) {
                case DataScience.restartKernel(): {
                    // Set our status
                    const status = this.statusProvider.set(DataScience.restartingKernelStatus());
                    try {
                        await this.restart();
                        restartedKernel = true;
                    } finally {
                        status.dispose();
                    }
                    break;
                }
                case DataScience.showJupyterLogs(): {
                    void this.commandManager.executeCommand(Commands.ViewJupyterOutput);
                }
            }
            return restartedKernel;
        };
        // Ensure we don't display this prompt multiple times,
        // if we are running multiple cells together.
        // Also clear this once the prompt has been dismissed.
        this.isPromptingForRestart = checkWhetherToRestart();
        this.isPromptingForRestart.finally(() => {
            this.isPromptingForRestart = undefined;
        });
        return this.isPromptingForRestart;
    }
    private async initializeAfterStart(
        reason: SysInfoReason,
        notebookDocument: NotebookDocument,
        placeholderCellPromise?: Promise<NotebookCell | undefined>
    ) {
        traceInfoIfCI('Started running kernel initialization');
        const notebook = this.notebook;
        if (!notebook) {
            traceInfoIfCI('Not running kernel initialization');
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
                traceInfoIfCI(`IKernel Status change to ${status}`);
                this._onStatusChanged.fire(status);
            };
            this.disposables.push(notebook.session.onSessionStatusChanged(statusChangeHandler));
        }

        if (isPythonKernelConnection(this.kernelConnectionMetadata)) {
            // So that we don't have problems with ipywidgets, always register the default ipywidgets comm target.
            // Restart sessions and retries might make this hard to do correctly otherwise.
            notebook.session.registerCommTarget(Identifiers.DefaultCommTarget, noop);

            // Change our initial directory and path
            await this.updateWorkingDirectoryAndPath(this.resourceUri?.fsPath);
            traceInfoIfCI('After updating working directory');
            await this.disableJedi();
            traceInfoIfCI('After Disabing jedi');

            // For Python notebook initialize matplotlib
            await this.initializeMatplotLib();
            traceInfoIfCI('After initializing matplotlib');

            if (isLocalConnection(this.kernelConnectionMetadata)) {
                await sendTelemetryForPythonKernelExecutable(
                    this,
                    this.resourceUri,
                    this.kernelConnectionMetadata,
                    this.pythonExecutionFactory
                );
            }
        }

        // Run any startup commands that we have specified
        traceInfoIfCI('Run startup commands');
        await this.runStartupCommands();
        traceInfoIfCI('After running startup commands');

        try {
            traceInfoIfCI('Requesting Kernel info');
            const info = await notebook.session.requestKernelInfo();
            traceInfoIfCI('Got Kernel info');
            this._info = info?.content;
            this.addSysInfoForInteractive(reason, notebookDocument, placeholderCellPromise);
        } catch (ex) {
            traceWarning('Failed to request KernelInfo', ex);
        }
        traceInfoIfCI('End running kernel initialization, now waiting for idle');
        await notebook.session.waitForIdle(this.launchTimeout);
        traceInfoIfCI('End running kernel initialization, session is idle');
    }

    private async disableJedi() {
        await this.executeSilently(CodeSnippets.disableJedi);
    }

    /**
     *
     * After a kernel state change, update the interactive window with a sys info cell
     * indicating the new connection info
     * @param reason The reason for kernel state change
     * @param notebookDocument The document to add a sys info Markdown cell to
     * @param info The kernel info to include in the sys info message
     * @param placeholderCell The target sys info cell to overwrite, if any
     */
    private addSysInfoForInteractive(
        reason: SysInfoReason,
        notebookDocument: NotebookDocument,
        placeholderCellPromise: Promise<NotebookCell | undefined> = Promise.resolve(undefined)
    ) {
        if (
            notebookDocument.notebookType !== InteractiveWindowView ||
            this.notebook === undefined ||
            !this._info ||
            this._info.status !== 'ok'
        ) {
            return;
        }

        const message = getSysInfoReasonHeader(reason, this.kernelConnectionMetadata);
        const sysInfoMessages = this._info.banner ? this._info.banner.split('\n') : [];
        // TODO: This condition is wrong, it will always be true.
        if (sysInfoMessages) {
            // Connection string only for our initial start, not restart or interrupt
            let connectionString: string = '';
            if (reason === SysInfoReason.Start) {
                connectionString = this.connection?.displayName || '';
            }

            // Update our sys info with our locally applied data.
            sysInfoMessages.unshift(message);
            if (connectionString && connectionString.length) {
                sysInfoMessages.unshift(connectionString);
            }

            void chainWithPendingUpdates(notebookDocument, async (edit) => {
                // Overwrite the given placeholder cell if any, or the most recent placeholder cell
                if (notebookDocument.cellCount > 0) {
                    const cell =
                        (await placeholderCellPromise) ?? notebookDocument.cellAt(notebookDocument.cellCount - 1);
                    if (cell !== undefined && cell.index >= 0) {
                        if (
                            cell.kind === NotebookCellKind.Markup &&
                            cell.metadata.isInteractiveWindowMessageCell &&
                            cell.metadata.isPlaceholder
                        ) {
                            edit.replace(
                                cell.document.uri,
                                new Range(0, 0, cell.document.lineCount, 0),
                                sysInfoMessages.join('  \n')
                            );
                            edit.replaceNotebookCellMetadata(notebookDocument.uri, cell.index, {
                                isInteractiveWindowMessageCell: true,
                                isPlaceholder: false
                            });
                            return;
                        }
                    }
                }

                // Append a markdown cell containing the sys info to the end of the NotebookDocument
                const markdownCell = new NotebookCellData(
                    NotebookCellKind.Markup,
                    sysInfoMessages.join('  \n'),
                    MARKDOWN_LANGUAGE
                );
                markdownCell.metadata = { isInteractiveWindowMessageCell: true };
                edit.replaceNotebookCells(
                    notebookDocument.uri,
                    new NotebookRange(notebookDocument.cellCount, notebookDocument.cellCount),
                    [markdownCell]
                );
            });
        }
    }
    private async initializeMatplotLib(): Promise<void> {
        const settings = this.configService.getSettings(this.resourceUri);
        if (settings && settings.themeMatplotlibPlots) {
            // We're theming matplotlibs, so we have to setup our default state.
            traceInfoIfCI(
                `Initialize config for plots for ${(this.resourceUri || this.notebookDocument.uri).toString()}`
            );
            const matplobInit =
                !settings || settings.generateSVGPlots
                    ? CodeSnippets.MatplotLibInitSvg
                    : CodeSnippets.MatplotLibInitPng;

            traceInfo(`Initialize matplotlib for ${(this.resourceUri || this.notebookDocument.uri).toString()}`);
            // Force matplotlib to inline and save the default style. We'll use this later if we
            // get a request to update style
            await this.executeSilently(matplobInit);

            // TODO: This must be joined with the previous request (else we send two seprate requests unnecessarily).
            const useDark = this.appShell.activeColorTheme.kind === ColorThemeKind.Dark;
            if (!settings.ignoreVscodeTheme) {
                // Reset the matplotlib style based on if dark or not.
                await this.executeSilently(
                    useDark
                        ? "matplotlib.style.use('dark_background')"
                        : `matplotlib.rcParams.update(${Identifiers.MatplotLibDefaultParams})`
                );
            }
        } else {
            const configInit = settings && settings.generateSVGPlots ? CodeSnippets.ConfigSvg : CodeSnippets.ConfigPng;
            traceInfoIfCI(
                `Initialize config for plots for ${(this.resourceUri || this.notebookDocument.uri).toString()}`
            );
            await this.executeSilently(configInit);
        }
    }
    private async runStartupCommands() {
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
            await this.executeSilently(cleanedUp);
        }
    }

    private async updateWorkingDirectoryAndPath(launchingFile?: string): Promise<void> {
        traceInfo('UpdateWorkingDirectoryAndPath in Kernel');
        if (isLocalConnection(this.kernelConnectionMetadata)) {
            let suggestedDir = await calculateWorkingDirectory(this.configService, this.workspaceService, this.fs);
            if (suggestedDir && (await this.fs.localDirectoryExists(suggestedDir))) {
                // We should use the launch info directory. It trumps the possible dir
                return this.changeDirectoryIfPossible(suggestedDir);
            } else if (launchingFile && (await this.fs.localFileExists(launchingFile))) {
                // Combine the working directory with this file if possible.
                suggestedDir = expandWorkingDir(suggestedDir, launchingFile, this.workspaceService);
                if (suggestedDir && (await this.fs.localDirectoryExists(suggestedDir))) {
                    return this.changeDirectoryIfPossible(suggestedDir);
                }
            }
        }
    }

    // Update both current working directory and sys.path with the desired directory
    private async changeDirectoryIfPossible(directory: string): Promise<void> {
        if (
            isLocalConnection(this.kernelConnectionMetadata) &&
            isPythonKernelConnection(this.kernelConnectionMetadata)
        ) {
            traceInfo('changeDirectoryIfPossible');
            await this.executeSilently(CodeSnippets.UpdateCWDAndPath.format(directory));
        }
    }

    private async executeSilently(code: string) {
        if (!this.notebook) {
            return;
        }
        await executeSilently(this.notebook.session, code);
    }
}

export function executeSilentlySync(session: IJupyterSession, code: string) {
    traceInfo(
        `Executing (and forget) (status ${session.status}) silently Code = ${code
            .substring(0, 100)
            .splitLines()
            .join('\\n')}`
    );
    session.requestExecute(
        {
            code: code.replace(/\r\n/g, '\n'),
            silent: false,
            stop_on_error: false,
            allow_stdin: true,
            store_history: false
        },
        true
    );
}

export async function executeSilently(session: IJupyterSession, code: string): Promise<nbformat.IOutput[]> {
    traceInfo(
        `Executing (status ${session.status}) silently Code = ${code.substring(0, 100).splitLines().join('\\n')}`
    );
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services');

    const request = session.requestExecute(
        {
            code: code.replace(/\r\n/g, '\n'),
            silent: false,
            stop_on_error: false,
            allow_stdin: true,
            store_history: false
        },
        true
    );
    const outputs: nbformat.IOutput[] = [];
    request.onIOPub = (msg) => {
        if (jupyterLab.KernelMessage.isStreamMsg(msg)) {
            traceInfoIfCI(`Got io pub message (stream), ${msg.content.text.substr(0, 100).splitLines().join('\\n')}`);
            if (
                outputs.length > 0 &&
                outputs[outputs.length - 1].output_type === 'stream' &&
                outputs[outputs.length - 1].name === msg.content.name
            ) {
                const streamOutput = outputs[outputs.length - 1] as nbformat.IStream;
                streamOutput.text += msg.content.text;
            } else {
                const streamOutput: nbformat.IStream = {
                    name: msg.content.name,
                    text: msg.content.text,
                    output_type: 'stream'
                };
                outputs.push(streamOutput);
            }
        } else if (jupyterLab.KernelMessage.isExecuteResultMsg(msg)) {
            traceInfoIfCI(`Got io pub message (execresult)}`);
            const output: nbformat.IExecuteResult = {
                data: msg.content.data,
                execution_count: msg.content.execution_count,
                metadata: msg.content.metadata,
                output_type: 'execute_result'
            };
            outputs.push(output);
        } else if (jupyterLab.KernelMessage.isDisplayDataMsg(msg)) {
            traceInfoIfCI(`Got io pub message (displaydata)}`);
            const output: nbformat.IDisplayData = {
                data: msg.content.data,
                metadata: msg.content.metadata,
                output_type: 'display_data'
            };
            outputs.push(output);
        } else if (jupyterLab.KernelMessage.isErrorMsg(msg)) {
            traceInfoIfCI(
                `Got io pub message (error), ${msg.content.ename},${
                    msg.content.evalue
                }, ${msg.content.traceback.join().substring(0, 100)}}`
            );
            const output: nbformat.IError = {
                ename: msg.content.ename,
                evalue: msg.content.evalue,
                traceback: msg.content.traceback,
                output_type: 'error'
            };
            outputs.push(output);
        } else {
            traceInfoIfCI(`Got io pub message (${msg.header.msg_type})`);
        }
    };
    await request.done;
    traceInfo(`Executing silently Code (completed) = ${code.substring(0, 100).splitLines().join('\\n')}`);

    return outputs;
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
            return concatMultilineString(stream.text, true);
        }
    }
    return;
}
