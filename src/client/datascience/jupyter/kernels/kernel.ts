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
import { ServerStatus } from '../../../../datascience-ui/interactive-common/mainState';
import { IApplicationShell, IWorkspaceService } from '../../../common/application/types';
import { traceError, traceInfo, traceInfoIf, traceWarning } from '../../../common/logger';
import { IFileSystem } from '../../../common/platform/types';
import { IConfigurationService, IDisposableRegistry, Resource } from '../../../common/types';
import { Deferred } from '../../../common/utils/async';
import { noop } from '../../../common/utils/misc';
import { StopWatch } from '../../../common/utils/stopWatch';
import { sendTelemetryEvent } from '../../../telemetry';
import { CodeSnippets, Identifiers, Telemetry } from '../../constants';
import {
    initializeInteractiveOrNotebookTelemetryBasedOnUserAction,
    sendKernelTelemetryEvent,
    trackKernelResourceInformation
} from '../../telemetry/telemetry';
import { getNotebookMetadata } from '../../notebook/helpers/helpers';
import {
    IDataScienceErrorHandler,
    IJupyterServerUriStorage,
    IJupyterSession,
    INotebook,
    INotebookEditorProvider,
    INotebookProvider,
    INotebookProviderConnection,
    InterruptResult,
    KernelSocketInformation
} from '../../types';
import { getSysInfoReasonHeader, isPythonKernelConnection, sendTelemetryForPythonKernelExecutable } from './helpers';
import { KernelExecution } from './kernelExecution';
import type { IKernel, KernelConnectionMetadata, NotebookCellRunState } from './types';
import { SysInfoReason } from '../../interactive-common/interactiveWindowTypes';
import { isCI, MARKDOWN_LANGUAGE } from '../../../common/constants';
import { InteractiveWindowView } from '../../notebook/constants';
import { chainWithPendingUpdates } from '../../notebook/helpers/notebookUpdater';
import { DataScience } from '../../../common/utils/localize';
import { CellOutputDisplayIdTracker } from './cellDisplayIdTracker';
import { calculateWorkingDirectory } from '../../utils';
import { expandWorkingDir } from '../jupyterUtils';
import type { nbformat } from '@jupyterlab/coreutils';
import { concatMultilineString } from '../../../../datascience-ui/common';
import { CellHashProviderFactory } from '../../editor-integration/cellHashProviderFactory';
import { IPythonExecutionFactory } from '../../../common/process/types';
import { INotebookControllerManager } from '../../notebook/types';
import { getResourceType } from '../../common';

export class Kernel implements IKernel {
    get connection(): INotebookProviderConnection | undefined {
        return this.notebook?.connection;
    }
    get onStatusChanged(): Event<ServerStatus> {
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
    get onDisposed(): Event<void> {
        return this._onDisposed.event;
    }
    private _info?: KernelMessage.IInfoReplyMsg['content'];
    get info(): KernelMessage.IInfoReplyMsg['content'] | undefined {
        return this._info;
    }
    get status(): ServerStatus {
        return this.notebook?.status ?? ServerStatus.NotStarted;
    }
    get disposed(): boolean {
        return this._disposed === true || this.notebook?.disposed === true;
    }
    get kernelSocket(): Observable<KernelSocketInformation | undefined> {
        return this._kernelSocket.asObservable();
    }
    public notebook?: INotebook;
    private _disposed?: boolean;
    private readonly _kernelSocket = new Subject<KernelSocketInformation | undefined>();
    private readonly _onStatusChanged = new EventEmitter<ServerStatus>();
    private readonly _onRestarted = new EventEmitter<void>();
    private readonly _onWillRestart = new EventEmitter<void>();
    private readonly _onWillInterrupt = new EventEmitter<void>();
    private readonly _onDisposed = new EventEmitter<void>();
    private _notebookPromise?: Promise<INotebook>;
    private readonly hookedNotebookForEvents = new WeakSet<INotebook>();
    private restarting?: Deferred<void>;
    private readonly kernelExecution: KernelExecution;
    private startCancellation = new CancellationTokenSource();
    constructor(
        public readonly notebookDocument: NotebookDocument,
        public readonly resourceUri: Resource,
        public readonly kernelConnectionMetadata: Readonly<KernelConnectionMetadata>,
        private readonly notebookProvider: INotebookProvider,
        private readonly disposables: IDisposableRegistry,
        private readonly launchTimeout: number,
        interruptTimeout: number,
        private readonly errorHandler: IDataScienceErrorHandler,
        private readonly editorProvider: INotebookEditorProvider,
        private readonly appShell: IApplicationShell,
        private readonly fs: IFileSystem,
        private readonly serverStorage: IJupyterServerUriStorage,
        controller: NotebookController,
        private readonly configService: IConfigurationService,
        outputTracker: CellOutputDisplayIdTracker,
        private readonly workspaceService: IWorkspaceService,
        private readonly cellHashProviderFactory: CellHashProviderFactory,
        private readonly pythonExecutionFactory: IPythonExecutionFactory,
        notebookControllerManager: INotebookControllerManager
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
        const isPreferredKernel =
            getResourceType(resourceUri) === 'notebook'
                ? notebookControllerManager.getPreferredNotebookController(this.notebookDocument)?.controller ===
                  controller
                : undefined;
        trackKernelResourceInformation(resourceUri, {
            kernelConnection: kernelConnectionMetadata,
            isPreferredKernel
        });
    }
    private perceivedJupyterStartupTelemetryCaptured?: boolean;
    public async executeCell(cell: NotebookCell): Promise<NotebookCellRunState> {
        sendKernelTelemetryEvent(this.resourceUri, Telemetry.ExecuteCell);
        const stopWatch = new StopWatch();
        const notebookPromise = this.startNotebook();
        if (cell.notebook.notebookType === InteractiveWindowView) {
            await this.cellHashProviderFactory.getOrCreate(this).addCellHash(cell);
        }
        const promise = this.kernelExecution.executeCell(notebookPromise, cell);
        this.trackNotebookCellPerceivedColdTime(stopWatch, notebookPromise, promise).catch(noop);
        await promise;
        return promise;
    }
    public async executeHidden(code: string, doc: NotebookDocument): Promise<nbformat.IOutput[]> {
        const stopWatch = new StopWatch();
        const notebookPromise = this.startNotebook();

        const promise = this.kernelExecution.executeHidden(notebookPromise, code, doc);

        this.trackNotebookCellPerceivedColdTime(stopWatch, notebookPromise, promise).catch(noop);
        return promise;
    }
    public async start(options: { disableUI?: boolean } = {}): Promise<void> {
        await this.startNotebook(options);
    }
    public async interrupt(): Promise<InterruptResult> {
        this._onWillInterrupt.fire();
        if (this.restarting) {
            traceInfo(
                `Interrupt requested & currently restarting ${(
                    this.resourceUri || this.notebookDocument.uri
                ).toString()}`
            );
            trackKernelResourceInformation(this.resourceUri, { interruptKernel: true });
            await this.restarting.promise;
        }
        traceInfo(`Interrupt requested ${(this.resourceUri || this.notebookDocument.uri).toString()}`);
        this.startCancellation.cancel();
        const interruptResultPromise = this.kernelExecution.interrupt(this._notebookPromise);
        await interruptResultPromise;
        return interruptResultPromise;
    }
    public async dispose(): Promise<void> {
        traceInfo(`Dispose kernel ${(this.resourceUri || this.notebookDocument.uri).toString()}`);
        this.restarting = undefined;
        this._notebookPromise = undefined;
        if (this.notebook) {
            await this.notebook.dispose();
            this._disposed = true;
            this._onDisposed.fire();
            this._onStatusChanged.fire(ServerStatus.Dead);
            this.notebook = undefined;
        }
        this.kernelExecution.dispose();
    }
    public async restart(): Promise<void> {
        this._onWillRestart.fire();
        if (this.restarting) {
            return this.restarting.promise;
        }
        traceInfo(`Restart requested ${this.notebookDocument.uri}`);
        this.startCancellation.cancel();
        const restartPromise = this.kernelExecution.restart(this._notebookPromise);
        await restartPromise;
        traceInfoIf(isCI, `Restarted ${this.notebookDocument.uri}`);

        // Interactive window needs a restart sys info
        await this.initializeAfterStart(SysInfoReason.Restart, this.notebookDocument);
        traceInfoIf(isCI, `Initialized after restart ${this.notebookDocument.uri}`);

        // Indicate a restart occurred if it succeeds
        this._onRestarted.fire();
        traceInfoIf(isCI, `Event fired after restart ${this.notebookDocument.uri}`);
    }
    private async trackNotebookCellPerceivedColdTime(
        stopWatch: StopWatch,
        notebookPromise: Promise<INotebook | undefined>,
        executionPromise: Promise<unknown>
    ): Promise<void> {
        if (this.perceivedJupyterStartupTelemetryCaptured) {
            return;
        }
        const notebook = await notebookPromise;
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
    private async startNotebook(options?: { disableUI?: boolean }): Promise<INotebook> {
        if (!options?.disableUI) {
            // This means the user is actually running something against the kernel (deliberately).
            initializeInteractiveOrNotebookTelemetryBasedOnUserAction(this.resourceUri, this.kernelConnectionMetadata);
        }
        if (this.restarting) {
            await this.restarting.promise;
        }
        if (!this._notebookPromise) {
            this.startCancellation = new CancellationTokenSource();
            this._notebookPromise = new Promise<INotebook>(async (resolve, reject) => {
                const stopWatch = new StopWatch();
                try {
                    try {
                        // No need to block kernel startup on UI updates.
                        const placeholderCellPromise = this.populateStartKernelInfoForInteractive(
                            this.notebookDocument,
                            this.kernelConnectionMetadata
                        );
                        traceInfo(`Starting Notebook in kernel.ts id = ${this.kernelConnectionMetadata.id}`);
                        this.notebook = await this.notebookProvider.getOrCreateNotebook({
                            identity: this.notebookDocument.uri,
                            resource: this.resourceUri,
                            disableUI: options?.disableUI,
                            getOnly: false,
                            metadata: getNotebookMetadata(this.notebookDocument), // No need to pass this, as we have a kernel connection (metadata is required in lower layers to determine the kernel connection).
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
                        traceError(`failed to create INotebook in kernel, UI Disabled = ${options?.disableUI}`, ex);
                        throw ex;
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
                } catch (ex) {
                    sendKernelTelemetryEvent(
                        this.resourceUri,
                        Telemetry.NotebookStart,
                        stopWatch.elapsedTime,
                        undefined,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        ex as any
                    );
                    if (options?.disableUI) {
                        sendTelemetryEvent(Telemetry.KernelStartFailedAndUIDisabled);
                    } else {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        this.errorHandler.handleError(ex as any).ignoreErrors(); // Just a notification, so don't await this
                    }
                    traceError(`failed to start INotebook in kernel, UI Disabled = ${options?.disableUI}`, ex);
                    this.startCancellation.cancel();
                    this._notebookPromise = undefined;
                    reject(ex);
                }
            });
        }
        return this._notebookPromise;
    }
    private async updateRemoteUriList(serverConnection: INotebookProviderConnection) {
        if (serverConnection.localLaunch) {
            return;
        }
        // Log this remote URI into our MRU list
        await this.serverStorage.addToUriList(
            serverConnection.url || serverConnection.displayName,
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

    private async initializeAfterStart(
        reason: SysInfoReason,
        notebookDocument: NotebookDocument,
        placeholderCellPromise?: Promise<NotebookCell | undefined>
    ) {
        traceInfoIf(isCI, 'Step A');
        if (!this.notebook) {
            return;
        }

        // Set the notebook property on the matching editor
        const editor = this.editorProvider.editors.find((item) =>
            this.fs.arePathsSame(item.file, this.notebookDocument.uri)
        );
        if (editor) {
            editor.notebook = this.notebook;
        }
        traceInfoIf(isCI, 'Step B');
        if (!this.hookedNotebookForEvents.has(this.notebook)) {
            this.hookedNotebookForEvents.add(this.notebook);
            this.notebook.kernelSocket.subscribe(this._kernelSocket);
            this.notebook.onDisposed(() => {
                traceInfo(
                    `Kernel got disposed as a result of notebook.onDisposed ${(
                        this.resourceUri || this.notebookDocument.uri
                    ).toString()}`
                );
                this._notebookPromise = undefined;
                this._onDisposed.fire();
            });
            this.notebook.onSessionStatusChanged(
                (e) => {
                    this._onStatusChanged.fire(e);
                },
                this,
                this.disposables
            );
            traceInfoIf(isCI, 'Step C');
        }

        if (isPythonKernelConnection(this.kernelConnectionMetadata)) {
            // Change our initial directory and path
            traceInfoIf(isCI, 'Step D');
            await this.updateWorkingDirectoryAndPath(this.resourceUri?.fsPath);
            traceInfoIf(isCI, 'Step H');

            traceInfoIf(isCI, 'Step I');
            await this.disableJedi();
            traceInfoIf(isCI, 'Step J');

            // For Python notebook initialize matplotlib
            await this.initializeMatplotLib();
            traceInfoIf(isCI, 'Step L');

            if (this.connection?.localLaunch && this.notebook) {
                await sendTelemetryForPythonKernelExecutable(
                    this.notebook,
                    this.resourceUri,
                    this.kernelConnectionMetadata,
                    this.pythonExecutionFactory
                );
            }
        }

        // Run any startup commands that we have specified
        traceInfoIf(isCI, 'Step M');
        await this.runStartupCommands();
        traceInfoIf(isCI, 'Step N');

        try {
            const info = await this.notebook.requestKernelInfo();
            this._info = info.content;
            traceInfoIf(isCI, 'Step N1');
            this.addSysInfoForInteractive(reason, notebookDocument, placeholderCellPromise);
            traceInfoIf(isCI, 'Step N2');
        } catch (ex) {
            traceWarning('Failed to request KernelInfo', ex);
        }
        traceInfoIf(isCI, 'Step O');
        await this.notebook.waitForIdle(this.launchTimeout);
        traceInfoIf(isCI, 'Step P');
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
            traceInfoIf(
                isCI,
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
            traceInfoIf(
                isCI,
                `Initialize config for plots for ${(this.resourceUri || this.notebookDocument.uri).toString()}`
            );
            await this.executeSilently(configInit);
        }
    }
    private async runStartupCommands() {
        const settings = this.configService.getSettings(this.resourceUri);
        // Run any startup commands that we specified. Support the old form too
        let setting = settings.runStartupCommands || settings.runMagicCommands;

        // Convert to string in case we get an array of startup commands.
        if (Array.isArray(setting)) {
            setting = setting.join(`\n`);
        }

        if (setting) {
            // Cleanup the line feeds. User may have typed them into the settings UI so they will have an extra \\ on the front.
            traceInfoIf(isCI, 'Begin Run startup code for notebook');
            const cleanedUp = setting.replace(/\\n/g, '\n');
            await this.executeSilently(cleanedUp);
            traceInfoIf(isCI, `Run startup code for notebook: ${cleanedUp}`);
        }
    }

    private async updateWorkingDirectoryAndPath(launchingFile?: string): Promise<void> {
        traceInfo('UpdateWorkingDirectoryAndPath in Kernel');
        if (this.connection && this.connection.localLaunch) {
            traceInfoIf(isCI, 'Step E');
            let suggestedDir = await calculateWorkingDirectory(this.configService, this.workspaceService, this.fs);
            traceInfoIf(isCI, 'Step F');
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
        traceInfoIf(isCI, 'Step G');
    }

    // Update both current working directory and sys.path with the desired directory
    private async changeDirectoryIfPossible(directory: string): Promise<void> {
        if (this.connection && this.connection.localLaunch && isPythonKernelConnection(this.kernelConnectionMetadata)) {
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

export async function executeSilently(session: IJupyterSession, code: string): Promise<nbformat.IOutput[]> {
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
    if (!request) {
        return [];
    }
    const outputs: nbformat.IOutput[] = [];
    request.onIOPub = (msg) => {
        if (jupyterLab.KernelMessage.isStreamMsg(msg)) {
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
            const output: nbformat.IExecuteResult = {
                data: msg.content.data,
                execution_count: msg.content.execution_count,
                metadata: msg.content.metadata,
                output_type: 'execute_result'
            };
            outputs.push(output);
        } else if (jupyterLab.KernelMessage.isDisplayDataMsg(msg)) {
            const output: nbformat.IDisplayData = {
                data: msg.content.data,
                metadata: msg.content.metadata,
                output_type: 'display_data'
            };
            outputs.push(output);
        } else if (jupyterLab.KernelMessage.isErrorMsg(msg)) {
            const output: nbformat.IError = {
                ename: msg.content.ename,
                evalue: msg.content.evalue,
                traceback: msg.content.traceback,
                output_type: 'error'
            };
            outputs.push(output);
        }
    };
    await request.done;

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
