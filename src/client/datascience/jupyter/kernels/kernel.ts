// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { KernelMessage } from '@jupyterlab/services';
import { Observable } from 'rxjs/Observable';
import { Subject } from 'rxjs/Subject';
import * as uuid from 'uuid/v4';
import * as path from 'path';
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
    Uri,
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
import { sendKernelTelemetryEvent, trackKernelResourceInformation } from '../../telemetry/telemetry';
import { getNotebookMetadata } from '../../notebook/helpers/helpers';
import {
    IDataScienceErrorHandler,
    IJupyterServerUriStorage,
    INotebook,
    INotebookEditorProvider,
    INotebookProvider,
    INotebookProviderConnection,
    InterruptResult,
    KernelSocketInformation
} from '../../types';
import { getSysInfoReasonHeader, isPythonKernelConnection } from './helpers';
import { KernelExecution } from './kernelExecution';
import type { IKernel, IKernelProvider, KernelConnectionMetadata } from './types';
import { SysInfoReason } from '../../interactive-common/interactiveWindowTypes';
import { isCI, MARKDOWN_LANGUAGE } from '../../../common/constants';
import { InteractiveWindowView } from '../../notebook/constants';
import { chainWithPendingUpdates } from '../../notebook/helpers/notebookUpdater';
import { DataScience } from '../../../common/utils/localize';
import { CellOutputDisplayIdTracker } from './cellDisplayIdTracker';
import { calculateWorkingDirectory } from '../../utils';
import { expandWorkingDir } from '../jupyterUtils';

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
    private _workingDirectory?: string;
    constructor(
        public readonly notebookUri: Uri,
        public readonly resourceUri: Resource,
        public readonly kernelConnectionMetadata: Readonly<KernelConnectionMetadata>,
        private readonly notebookProvider: INotebookProvider,
        private readonly disposables: IDisposableRegistry,
        private readonly launchTimeout: number,
        interruptTimeout: number,
        private readonly errorHandler: IDataScienceErrorHandler,
        private readonly editorProvider: INotebookEditorProvider,
        kernelProvider: IKernelProvider,
        private readonly appShell: IApplicationShell,
        private readonly fs: IFileSystem,
        private readonly serverStorage: IJupyterServerUriStorage,
        controller: NotebookController,
        private readonly configService: IConfigurationService,
        outputTracker: CellOutputDisplayIdTracker,
        private readonly workspaceService: IWorkspaceService
    ) {
        this.kernelExecution = new KernelExecution(
            kernelProvider,
            errorHandler,
            appShell,
            kernelConnectionMetadata,
            interruptTimeout,
            disposables,
            controller,
            outputTracker
        );
    }
    private perceivedJupyterStartupTelemetryCaptured?: boolean;
    public async executeCell(cell: NotebookCell): Promise<void> {
        const stopWatch = new StopWatch();
        const notebookPromise = this.startNotebook({ disableUI: false, document: cell.notebook });
        const promise = this.kernelExecution.executeCell(notebookPromise, cell);
        this.trackNotebookCellPerceivedColdTime(stopWatch, notebookPromise, promise).catch(noop);
        await promise;
    }
    public async executeAllCells(document: NotebookDocument): Promise<void> {
        const stopWatch = new StopWatch();
        const notebookPromise = this.startNotebook({ disableUI: false, document });
        const promise = this.kernelExecution.executeAllCells(notebookPromise, document);
        this.trackNotebookCellPerceivedColdTime(stopWatch, notebookPromise, promise).catch(noop);
        await promise;
    }
    public async executeHidden(code: string, file: string, document: NotebookDocument) {
        const stopWatch = new StopWatch();
        const notebookPromise = this.startNotebook({ disableUI: false, document });
        const promise = this.notebook!.execute(code, file, 0, uuid(), undefined, true);
        this.trackNotebookCellPerceivedColdTime(stopWatch, notebookPromise, promise).catch(noop);
        await promise;
    }
    public async start(options: { disableUI?: boolean; document: NotebookDocument }): Promise<void> {
        await this.startNotebook(options);
    }
    public async interrupt(document: NotebookDocument): Promise<InterruptResult> {
        this._onWillInterrupt.fire();
        if (this.restarting) {
            traceInfo(`Interrupt requested & currently restarting ${document.uri}`);
            trackKernelResourceInformation(document.uri, { interruptKernel: true });
            await this.restarting.promise;
        }
        traceInfo(`Interrupt requested ${document.uri}`);
        this.startCancellation.cancel();
        const interruptResultPromise = this.kernelExecution.interrupt(document, this._notebookPromise);
        await interruptResultPromise;
        return interruptResultPromise;
    }
    public async dispose(): Promise<void> {
        traceInfo(`Dispose kernel ${this.notebookUri.toString()}`);
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
    public async restart(notebookDocument: NotebookDocument): Promise<void> {
        this._onWillRestart.fire();
        if (this.restarting) {
            return this.restarting.promise;
        }
        traceInfo(`Restart requested ${notebookDocument.uri}`);
        this.startCancellation.cancel();
        const restartPromise = this.kernelExecution.restart(notebookDocument, this._notebookPromise);
        await restartPromise;
        traceInfoIf(isCI, `Restarted ${notebookDocument.uri}`);

        // Interactive window needs a restart sys info
        await this.initializeAfterStart(SysInfoReason.Restart, notebookDocument);
        traceInfoIf(isCI, `Initialized after restart ${notebookDocument.uri}`);

        // Indicate a restart occurred if it succeeds
        this._onRestarted.fire();
        traceInfoIf(isCI, `Event fired after restart ${notebookDocument.uri}`);
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
    private async startNotebook(options: { disableUI?: boolean; document: NotebookDocument }): Promise<INotebook> {
        if (this.restarting) {
            await this.restarting.promise;
        }
        if (!this._notebookPromise) {
            this.startCancellation = new CancellationTokenSource();
            this._notebookPromise = new Promise<INotebook>(async (resolve, reject) => {
                const stopWatch = new StopWatch();
                try {
                    try {
                        await this.populateStartKernelInfoForInteractive(
                            options.document,
                            this.kernelConnectionMetadata
                        );
                        traceInfo(`Starting Notebook in kernel.ts id = ${this.kernelConnectionMetadata.id}`);
                        this.notebook = await this.notebookProvider.getOrCreateNotebook({
                            identity: this.notebookUri,
                            resource: this.resourceUri,
                            disableUI: options?.disableUI,
                            getOnly: false,
                            metadata: getNotebookMetadata(options.document), // No need to pass this, as we have a kernel connection (metadata is required in lower layers to determine the kernel connection).
                            kernelConnection: this.kernelConnectionMetadata,
                            token: this.startCancellation.token
                        });
                        if (!this.notebook) {
                            // This is an unlikely case.
                            // getOrCreateNotebook would return undefined only if getOnly = true (an issue with typings).
                            throw new Error('Kernel has not been started');
                        }
                    } catch (ex) {
                        traceError(`failed to create INotebook in kernel, UI Disabled = ${options.disableUI}`, ex);
                        throw ex;
                    }
                    await this.initializeAfterStart(SysInfoReason.Start, options.document);
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
                        options.document.uri,
                        Telemetry.NotebookStart,
                        stopWatch.elapsedTime,
                        undefined,
                        ex
                    );
                    if (options.disableUI) {
                        sendTelemetryEvent(Telemetry.KernelStartFailedAndUIDisabled);
                    } else {
                        this.errorHandler.handleError(ex).ignoreErrors(); // Just a notification, so don't await this
                    }
                    traceError(`failed to start INotebook in kernel, UI Disabled = ${options.disableUI}`, ex);
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
        }
    }

    private async initializeAfterStart(reason: SysInfoReason, notebookDocument: NotebookDocument) {
        traceInfoIf(isCI, 'Step A');
        if (!this.notebook) {
            return;
        }

        // Set the notebook property on the matching editor
        const editor = this.editorProvider.editors.find((item) => this.fs.arePathsSame(item.file, this.notebookUri));
        if (editor) {
            editor.notebook = this.notebook;
        }
        traceInfoIf(isCI, 'Step B');
        if (!this.hookedNotebookForEvents.has(this.notebook)) {
            this.hookedNotebookForEvents.add(this.notebook);
            this.notebook.kernelSocket.subscribe(this._kernelSocket);
            this.notebook.onDisposed(() => {
                traceInfo(`Kernel got disposed as a result of notebook.onDisposed ${this.notebookUri.toString()}`);
                this._notebookPromise = undefined;
                this._onDisposed.fire();
            });
            this.notebook.onSessionStatusChanged(
                (e) => {
                    traceInfo(`Notebook Session status ${this.notebook?.identity} # ${e}`);
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
        }

        // Run any startup commands that we have specified
        traceInfoIf(isCI, 'Step M');
        await this.runStartupCommands();
        traceInfoIf(isCI, 'Step N');

        await this.notebook
            .requestKernelInfo()
            .then(async (item) => {
                this._info = item.content;
                traceInfoIf(isCI, 'Step N1');
                await this.addSysInfoForInteractive(reason, notebookDocument, item);
                traceInfoIf(isCI, 'Step N2');
            })
            .catch(traceWarning.bind('Failed to request KernelInfo'));
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
     */
    private async addSysInfoForInteractive(
        reason: SysInfoReason,
        notebookDocument: NotebookDocument,
        info: KernelMessage.IInfoReplyMsg
    ) {
        if (notebookDocument.notebookType !== InteractiveWindowView || this.notebook === undefined) {
            return;
        }

        const message = getSysInfoReasonHeader(reason, this.kernelConnectionMetadata);
        const bannerMessage = (info.content as KernelMessage.IInfoReply)?.banner || '';
        const sysInfoMessages = bannerMessage ? bannerMessage.split('\n') : [];
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

            // Append a markdown cell containing the sys info to the end of the NotebookDocument
            return chainWithPendingUpdates(notebookDocument, (edit) => {
                if (notebookDocument.cellCount) {
                    const lastCell = notebookDocument.cellAt(notebookDocument.cellCount - 1);

                    if (
                        lastCell.kind === NotebookCellKind.Markup &&
                        lastCell.metadata.isInteractiveWindowMessageCell &&
                        lastCell.metadata.isPlaceholder
                    ) {
                        edit.replace(
                            lastCell.document.uri,
                            new Range(0, 0, lastCell.document.lineCount, 0),
                            sysInfoMessages.join('  \n')
                        );
                        edit.replaceNotebookCellMetadata(notebookDocument.uri, lastCell.index, {
                            isInteractiveWindowMessageCell: true
                        });
                        return;
                    }
                }

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
            traceInfoIf(isCI, `Initialize config for plots for ${(this.resourceUri || this.notebookUri).toString()}`);
            const matplobInit =
                !settings || settings.enablePlotViewer
                    ? CodeSnippets.MatplotLibInitSvg
                    : CodeSnippets.MatplotLibInitPng;

            traceInfo(`Initialize matplotlib for ${(this.resourceUri || this.notebookUri).toString()}`);
            // Force matplotlib to inline and save the default style. We'll use this later if we
            // get a request to update style
            await this.executeSilently(matplobInit);

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
            const configInit = settings && settings.enablePlotViewer ? CodeSnippets.ConfigSvg : CodeSnippets.ConfigPng;
            traceInfoIf(isCI, `Initialize config for plots for ${(this.resourceUri || this.notebookUri).toString()}`);
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
            const suggestedDir = await calculateWorkingDirectory(this.configService, this.workspaceService, this.fs);
            traceInfoIf(isCI, 'Step F');
            if (suggestedDir && (await this.fs.localDirectoryExists(suggestedDir))) {
                // We should use the launch info directory. It trumps the possible dir
                this._workingDirectory = suggestedDir;
                return this.changeDirectoryIfPossible(this._workingDirectory);
            } else if (
                launchingFile &&
                (await this.fs.localFileExists(launchingFile)) &&
                (await this.fs.localDirectoryExists(path.dirname(launchingFile)))
            ) {
                // Combine the working directory with this file if possible.
                this._workingDirectory = expandWorkingDir(suggestedDir, launchingFile, this.workspaceService);
                if (this._workingDirectory) {
                    return this.changeDirectoryIfPossible(this._workingDirectory);
                }
            }
        }
        traceInfoIf(isCI, 'Step G');
    }

    // Update both current working directory and sys.path with the desired directory
    private changeDirectoryIfPossible = async (directory: string): Promise<void> => {
        if (
            this.connection &&
            this.connection.localLaunch &&
            isPythonKernelConnection(this.kernelConnectionMetadata) &&
            (await this.fs.localDirectoryExists(directory))
        ) {
            traceInfo('changeDirectoryIfPossible');
            await this.executeSilently(CodeSnippets.UpdateCWDAndPath.format(directory));
        }
    };

    private async executeSilently(code: string) {
        if (!this.notebook) {
            return;
        }
        const request = this.notebook.session.requestExecute(
            {
                code,
                silent: true,
                stop_on_error: false,
                allow_stdin: true,
                store_history: false
            },
            true
        );

        await request?.done;
    }
}
