// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';
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
    ColorThemeKind,
    Disposable,
    Uri
} from 'vscode';
import { IApplicationShell, IWorkspaceService } from '../platform/common/application/types';
import { WrappedError } from '../platform/errors/types';
import { disposeAllDisposables } from '../platform/common/helpers';
import { traceInfo, traceInfoIfCI, traceError, traceVerbose, traceWarning } from '../platform/logging';
import { getDisplayPath, getFilePath } from '../platform/common/platform/fs-paths';
import {
    Resource,
    IDisposableRegistry,
    IConfigurationService,
    IDisposable,
    IDisplayOptions
} from '../platform/common/types';
import { Deferred, sleep } from '../platform/common/utils/async';
import { DataScience } from '../platform/common/utils/localize';
import { noop } from '../platform/common/utils/misc';
import { StopWatch } from '../platform/common/utils/stopWatch';
import { CellHashProviderFactory } from '../interactive-window/editor-integration/cellHashProviderFactory';
import { JupyterConnectError } from '../platform/errors/jupyterConnectError';
import {
    sendKernelTelemetryEvent,
    initializeInteractiveOrNotebookTelemetryBasedOnUserAction
} from '../telemetry/telemetry';
import { sendTelemetryEvent } from '../telemetry';
import { concatMultilineString } from '../webviews/webview-side/common';
import { Telemetry, Identifiers, CodeSnippets } from '../webviews/webview-side/common/constants';
import { executeSilently, getDisplayNameOrNameOfKernelConnection, isPythonKernelConnection } from './helpers';
import {
    IJupyterSession,
    IKernel,
    INotebook,
    INotebookProvider,
    INotebookProviderConnection,
    isLocalConnection,
    KernelConnectionMetadata,
    KernelSocketInformation,
    NotebookCellRunState
} from './types';
import { Cancellation } from '../platform/common/cancellation';
import { KernelProgressReporter } from '../platform/progress/kernelProgressReporter';
import { DisplayOptions } from './displayOptions';
import { SilentExecutionErrorOptions } from './helpers';

export abstract class BaseKernel implements IKernel {
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
    protected notebook?: INotebook;
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
    public abstract get pendingCells(): readonly NotebookCell[];
    protected _disposed?: boolean;
    protected _disposing?: boolean;
    protected _ignoreNotebookDisposedErrors?: boolean;
    private readonly _kernelSocket = new ReplaySubject<KernelSocketInformation | undefined>();
    protected readonly _onStatusChanged = new EventEmitter<KernelMessage.Status>();
    protected readonly _onRestarted = new EventEmitter<void>();
    private readonly _onStarted = new EventEmitter<void>();
    protected readonly _onDisposed = new EventEmitter<void>();
    protected readonly _onPreExecute = new EventEmitter<NotebookCell>();
    protected _notebookPromise?: Promise<INotebook>;
    private readonly hookedNotebookForEvents = new WeakSet<INotebook>();
    protected eventHooks: ((ev: 'willInterrupt' | 'willRestart') => Promise<void>)[] = [];
    protected restarting?: Deferred<void>;
    protected startCancellation = new CancellationTokenSource();
    private startupUI = new DisplayOptions(true);
    constructor(
        public readonly id: Uri,
        public readonly resourceUri: Resource,
        public readonly kernelConnectionMetadata: Readonly<KernelConnectionMetadata>,
        private readonly notebookProvider: INotebookProvider,
        private readonly disposables: IDisposableRegistry,
        private readonly launchTimeout: number,
        protected readonly appShell: IApplicationShell,
        public readonly controller: NotebookController,
        protected readonly configService: IConfigurationService,
        protected readonly workspaceService: IWorkspaceService,
        readonly cellHashProviderFactory: CellHashProviderFactory
    ) {}
    private perceivedJupyterStartupTelemetryCaptured?: boolean;

    public addEventHook(hook: (event: 'willRestart' | 'willInterrupt') => Promise<void>): void {
        this.eventHooks.push(hook);
    }

    public removeEventHook(hook: (event: 'willRestart' | 'willInterrupt') => Promise<void>): void {
        this.eventHooks = this.eventHooks.filter((h) => h !== hook);
    }

    public abstract executeCell(cell: NotebookCell): Promise<NotebookCellRunState>;
    public async executeHidden(code: string): Promise<nbformat.IOutput[]> {
        const stopWatch = new StopWatch();
        const sessionPromise = this.startNotebook().then((nb) => nb.session);
        const promise = sessionPromise.then((session) => executeSilently(session, code));
        this.trackNotebookCellPerceivedColdTime(stopWatch, sessionPromise, promise).catch(noop);
        return promise;
    }
    public async start(options?: IDisplayOptions): Promise<void> {
        await this.startNotebook(options);
    }
    public abstract interrupt(): Promise<void>;
    public abstract dispose(): Promise<void>;
    public abstract restart(): Promise<void>;
    protected async trackNotebookCellPerceivedColdTime(
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
    protected async startNotebook(options: IDisplayOptions = new DisplayOptions(false)): Promise<INotebook> {
        traceVerbose(`Start Notebook in kernel.ts with disableUI = ${options.disableUI}`);
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
                this.startCancellation = new CancellationTokenSource();
            }
            this._notebookPromise = this.createNotebook(new StopWatch()).catch((ex) => {
                traceInfoIfCI(`Failed to create Notebook in Kernel.startNotebook for ${getDisplayPath(this.id)}`);
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
                `Starting Notebook id = ${this.kernelConnectionMetadata.id} for ${getDisplayPath(this.id)} (disableUI=${
                    this.startupUI.disableUI
                })`
            );
            this.createProgressIndicator(disposables);
            this.isKernelDead = false;
            this._onStatusChanged.fire('starting');
            const notebook = await this.notebookProvider.createNotebook({
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
            await this.initializeAfterStart(notebook);

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

    protected abstract sendTelemetryForPythonKernelExecutable(): Promise<void>;

    protected async initializeAfterStart(notebook: INotebook | undefined) {
        traceVerbose(`Started running kernel initialization for ${getDisplayPath(this.id)}`);
        if (!notebook) {
            traceVerbose('Not running kernel initialization');
            return;
        }
        if (!this.hookedNotebookForEvents.has(notebook)) {
            this.hookedNotebookForEvents.add(notebook);
            notebook.session.kernelSocket.subscribe(this._kernelSocket);
            notebook.session.onDidDispose(() => {
                traceInfoIfCI(
                    `Kernel got disposed as a result of notebook.onDisposed ${getDisplayPath(
                        this.resourceUri || this.id
                    )}`
                );
                // Ignore when notebook is disposed as a result of failed restarts.
                if (!this._ignoreNotebookDisposedErrors) {
                    traceInfo(
                        `Kernel got disposed as a result of notebook.onDisposed ${getDisplayPath(
                            this.resourceUri || this.id
                        )} & _ignoreNotebookDisposedErrors = false.`
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
                await this.sendTelemetryForPythonKernelExecutable();
            }
        }

        // If this is a live kernel, we shouldn't be changing anything by running startup code.
        if (this.kernelConnectionMetadata.kind !== 'connectToLiveRemoteKernel') {
            // Gather all of the startup code at one time and execute as one cell
            const startupCode = await this.gatherInternalStartupCode();
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
            if (this.kernelConnectionMetadata.kind === 'connectToLiveRemoteKernel') {
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
        if (this.kernelConnectionMetadata.kind !== 'connectToLiveRemoteKernel') {
            traceVerbose('End running kernel initialization, now waiting for idle');
            await notebook.session.waitForIdle(this.launchTimeout);
            traceVerbose('End running kernel initialization, session is idle');
        }
    }

    private async gatherInternalStartupCode(): Promise<string[]> {
        // Gather all of the startup code into a giant string array so we
        // can execute it all at once.
        const result: string[] = [];

        if (isPythonKernelConnection(this.kernelConnectionMetadata)) {
            const [changeDirScripts, debugCellScripts] = await Promise.all([
                // Change our initial directory and path
                this.getUpdateWorkingDirectoryAndPathCode(this.resourceUri),
                // Initialize debug cell support.
                // (IPYKERNEL_CELL_NAME has to be set on every cell execution, but we can't execute a cell to change it)
                this.getDebugCellHook()
            ]);

            // Have our debug cell script run first for safety
            result.push(...debugCellScripts);
            result.push(...changeDirScripts);

            // Set the ipynb file
            const file = getFilePath(this.resourceUri);
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
            traceInfoIfCI(`Initialize config for plots for ${getDisplayPath(this.resourceUri || this.id)}`);

            const matplotInit = CodeSnippets.MatplotLibInit;

            traceInfo(`Initialize matplotlib for ${getDisplayPath(this.resourceUri || this.id)}`);
            // Force matplotlib to inline and save the default style. We'll use this later if we
            // get a request to update style
            results.push(...matplotInit.splitLines({ trim: false }));

            // TODO: This must be joined with the previous request (else we send two separate requests unnecessarily).
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

    protected abstract getDebugCellHook(): Promise<string[]>;

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

    protected abstract getUpdateWorkingDirectoryAndPathCode(launchingFile?: Resource): Promise<string[]>;

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
