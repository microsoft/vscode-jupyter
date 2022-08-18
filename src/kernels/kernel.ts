// Copyright (c) Microsoft Corporation.
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
    Uri,
    NotebookDocument
} from 'vscode';
import { CodeSnippets, Identifiers } from '../platform/common/constants';
import { IApplicationShell } from '../platform/common/application/types';
import { WrappedError } from '../platform/errors/types';
import { disposeAllDisposables } from '../platform/common/helpers';
import { traceInfo, traceInfoIfCI, traceError, traceVerbose, traceWarning } from '../platform/logging';
import { getDisplayPath, getFilePath } from '../platform/common/platform/fs-paths';
import {
    Resource,
    IConfigurationService,
    IDisposable,
    IDisplayOptions,
    IExtensionContext
} from '../platform/common/types';
import { sleep } from '../platform/common/utils/async';
import { DataScience } from '../platform/common/utils/localize';
import { noop } from '../platform/common/utils/misc';
import { StopWatch } from '../platform/common/utils/stopWatch';
import { concatMultilineString } from '../platform/common/utils';
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
    IKernelConnectionSession,
    INotebookProvider,
    InterruptResult,
    isLocalConnection,
    IStartupCodeProvider,
    ITracebackFormatter,
    KernelConnectionMetadata,
    KernelSocketInformation,
    NotebookCellRunState,
    IBaseKernel,
    KernelActionSource
} from './types';
import { Cancellation, isCancellationError } from '../platform/common/cancellation';
import { KernelProgressReporter } from '../platform/progress/kernelProgressReporter';
import { DisplayOptions } from './displayOptions';
import { SilentExecutionErrorOptions } from './helpers';
import { IStatusProvider } from '../platform/progress/types';
import { CellOutputDisplayIdTracker } from './execution/cellDisplayIdTracker';
import { traceCellMessage } from './execution/helpers';
import { BaseKernelExecution, KernelExecution, ThirdPartyKernelExecution } from './execution/kernelExecution';

/**
 * Represents an active kernel process running on the jupyter (or local) machine.
 */
abstract class BaseKernel<TKernelExecution extends BaseKernelExecution> implements IBaseKernel {
    protected readonly disposables: IDisposable[] = [];
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
        return this._disposed === true || this._session?.disposed === true;
    }
    get disposing(): boolean {
        return this._disposing === true;
    }
    get kernelSocket(): Observable<KernelSocketInformation | undefined> {
        return this._kernelSocket.asObservable();
    }
    private _session?: IKernelConnectionSession;
    /**
     * If the session died, then ensure the status is set to `dead`.
     * We need to provide an accurate status.
     * `unknown` is generally used to indicate jupyter kernel hasn't started.
     * If a jupyter kernel dies after it has started, then status is set to `dead`.
     */
    private isKernelDead?: boolean;
    public get session(): IKernelConnectionSession | undefined {
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
    private _jupyterSessionPromise?: Promise<IKernelConnectionSession>;
    private readonly hookedSessionForEvents = new WeakSet<IKernelConnectionSession>();
    private eventHooks: ((ev: 'willInterrupt' | 'willRestart') => Promise<void>)[] = [];
    private startCancellation = new CancellationTokenSource();
    private startupUI = new DisplayOptions(true);
    protected kernelExecution: TKernelExecution;
    private disposingPromise?: Promise<void>;
    constructor(
        public readonly uri: Uri,
        public readonly resourceUri: Resource,
        public readonly kernelConnectionMetadata: Readonly<KernelConnectionMetadata>,
        protected readonly notebookProvider: INotebookProvider,
        protected readonly launchTimeout: number,
        protected readonly interruptTimeout: number,
        protected readonly appShell: IApplicationShell,
        protected readonly configService: IConfigurationService,
        protected readonly statusProvider: IStatusProvider,
        protected readonly startupCodeProviders: IStartupCodeProvider[],
        private readonly _creator: KernelActionSource
    ) {
        this.disposables.push(this._onStatusChanged);
        this.disposables.push(this._onRestarted);
        this.disposables.push(this._onStarted);
        this.disposables.push(this._onDisposed);
        this.disposables.push({ dispose: () => this._kernelSocket.unsubscribe() });
        trackKernelResourceInformation(this.resourceUri, {
            kernelConnection: this.kernelConnectionMetadata,
            actionSource: this.creator,
            disableUI: this.startupUI.disableUI
        });
        this.startupUI.onDidChangeDisableUI(() => {
            if (!this.startupUI.disableUI) {
                trackKernelResourceInformation(this.resourceUri, {
                    disableUI: false
                });
            }
        }, this.disposables);
    }

    public addEventHook(hook: (event: 'willRestart' | 'willInterrupt') => Promise<void>): void {
        this.eventHooks.push(hook);
    }

    public removeEventHook(hook: (event: 'willRestart' | 'willInterrupt') => Promise<void>): void {
        this.eventHooks = this.eventHooks.filter((h) => h !== hook);
    }

    public async start(options?: IDisplayOptions): Promise<void> {
        await this.startJupyterSession(options);
    }
    public async interrupt(): Promise<void> {
        await Promise.all(this.eventHooks.map((h) => h('willInterrupt')));
        trackKernelResourceInformation(this.resourceUri, { interruptKernel: true });
        traceInfo(`Interrupt requested ${getDisplayPath(this.resourceUri || this.uri)}`);
        this.startCancellation.cancel();
        const interruptResultPromise = this.kernelExecution.interrupt(this._jupyterSessionPromise);

        const status = this.statusProvider.set(DataScience.interruptKernelStatus());
        let result: InterruptResult | undefined;
        try {
            traceInfo(`Interrupt requested & sent for ${getDisplayPath(this.uri)} in notebookEditor.`);
            result = await interruptResultPromise;
            if (result === InterruptResult.TimedOut) {
                const message = DataScience.restartKernelAfterInterruptMessage();
                const yes = DataScience.restartKernelMessageYes();
                const v = await this.appShell.showInformationMessage(message, { modal: true }, yes);
                if (v === yes) {
                    await this.restart();
                }
            }
        } finally {
            status.dispose();
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
            promises.push(this.kernelExecution.cancel());
            this._session = this._session
                ? this._session
                : this._jupyterSessionPromise
                ? await this._jupyterSessionPromise
                : undefined;
            this._jupyterSessionPromise = undefined;
            if (this._session) {
                promises.push(this._session.dispose().catch(noop));
                this._session = undefined;
            }
            this._disposed = true;
            this._onDisposed.fire();
            this._onStatusChanged.fire('dead');
            this.kernelExecution.dispose();
            try {
                await Promise.all(promises);
            } finally {
                disposeAllDisposables(this.disposables);
            }
        };
        this.disposingPromise = disposeImpl();
        await this.disposingPromise;
    }
    public async restart(): Promise<void> {
        await Promise.all(this.eventHooks.map((h) => h('willRestart')));
        traceInfo(`Restart requested ${this.uri}`);
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
            // If the session died, then start a new session.
            await (this._jupyterSessionPromise
                ? this.kernelExecution.restart(this._jupyterSessionPromise)
                : this.start(new DisplayOptions(false)));
            sendKernelTelemetryEvent(this.resourceUri, Telemetry.NotebookRestart, stopWatch.elapsedTime);
        } catch (ex) {
            traceError(`Restart failed ${getDisplayPath(this.uri)}`, ex);
            this._ignoreJupyterSessionDisposedErrors = true;
            // If restart fails, kill the associated session.
            const session = this._session;
            this._session = undefined;
            this._jupyterSessionPromise = undefined;
            // If we get a kernel promise failure, then restarting timed out. Just shutdown and restart the entire server.
            // Note, this code might not be necessary, as such an error is thrown only when interrupting a kernel times out.
            sendKernelTelemetryEvent(this.resourceUri, Telemetry.NotebookRestart, stopWatch.elapsedTime, undefined, ex);
            await session?.dispose().catch(noop);
            this._ignoreJupyterSessionDisposedErrors = false;
            throw ex;
        } finally {
            status.dispose();
            progress.dispose();
        }

        // Interactive window needs a restart sys info
        await this.initializeAfterStart(this._session);

        // Indicate a restart occurred if it succeeds
        this._onRestarted.fire();
    }
    protected async startJupyterSession(
        options: IDisplayOptions = new DisplayOptions(false)
    ): Promise<IKernelConnectionSession> {
        traceVerbose(`Start Jupyter Session in kernel.ts with disableUI = ${options.disableUI}`);
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
        if (!this._jupyterSessionPromise) {
            // Don't create a new one unnecessarily.
            if (this.startCancellation.token.isCancellationRequested) {
                this.startCancellation = new CancellationTokenSource();
            }
            const stopWatch = new StopWatch();
            trackKernelResourceInformation(this.resourceUri, {
                kernelConnection: this.kernelConnectionMetadata,
                actionSource: this.creator
            });

            this._jupyterSessionPromise = this.createJupyterSession()
                .then((session) => {
                    sendKernelTelemetryEvent(
                        this.resourceUri,
                        Telemetry.PerceivedJupyterStartupNotebook,
                        stopWatch.elapsedTime
                    );
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
        return this._jupyterSessionPromise;
    }

    private async createJupyterSession(): Promise<IKernelConnectionSession> {
        let disposables: Disposable[] = [];
        try {
            // No need to block kernel startup on UI updates.
            let pythonInfo = '';
            if (this.kernelConnectionMetadata.interpreter) {
                const info: string[] = [];
                info.push(`Python Path: ${getDisplayPath(this.kernelConnectionMetadata.interpreter.envPath)}`);
                info.push(`EnvType: ${this.kernelConnectionMetadata.interpreter.envType}`);
                info.push(`EnvName: '${this.kernelConnectionMetadata.interpreter.envName}'`);
                info.push(`Version: ${this.kernelConnectionMetadata.interpreter.version?.raw}`);
                pythonInfo = ` (${info.join(', ')})`;
            }
            traceInfo(
                `Starting Jupyter Session id = '${this.kernelConnectionMetadata.kind}:${
                    this.kernelConnectionMetadata.id
                }'${pythonInfo} for '${getDisplayPath(this.uri)}' (disableUI=${this.startupUI.disableUI})`
            );
            this.createProgressIndicator(disposables);
            this.isKernelDead = false;
            this._onStatusChanged.fire('starting');
            const session = await this.notebookProvider.create({
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
            const message = DataScience.sessionStartFailedWithKernel().format(
                getDisplayNameOrNameOfKernelConnection(this.kernelConnectionMetadata)
            );
            throw WrappedError.from(message + ' ' + ('message' in ex ? ex.message : ex.toString()), ex);
        } finally {
            disposeAllDisposables(disposables);
        }
    }
    private uiWasDisabledWhenKernelStartupTelemetryWasLastSent?: boolean;
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

        this.uiWasDisabledWhenKernelStartupTelemetryWasLastSent = this.startupUI.disableUI === true;
        // The corresponding failure telemetry property for the `Telemetry.NotebookStart` event will be sent in the Error Handler,
        // after we analyze the error.
        sendKernelTelemetryEvent(this.resourceUri, Telemetry.NotebookStart, undefined, {
            disableUI: this.startupUI.disableUI
        });
    }

    protected createProgressIndicator(disposables: IDisposable[]) {
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

    protected async initializeAfterStart(session: IKernelConnectionSession | undefined) {
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
                traceVerbose(`IKernel Status change to ${status}`);
                this._onStatusChanged.fire(status);
            };
            this.disposables.push(session.onSessionStatusChanged(statusChangeHandler));
        }

        // So that we don't have problems with ipywidgets, always register the default ipywidgets comm target.
        // Restart sessions and retries might make this hard to do correctly otherwise.
        session.registerCommTarget(Identifiers.DefaultCommTarget, noop);

        // Gather all of the startup code at one time and execute as one cell
        const startupCode = await this.gatherInternalStartupCode();
        await this.executeSilently(session, startupCode, {
            traceErrors: true,
            traceErrorsMessage: 'Error executing jupyter extension internal startup code',
            telemetryName: Telemetry.KernelStartupCodeFailure
        });
        if (this.kernelConnectionMetadata.kind !== 'connectToLiveRemoteKernel') {
            // Run user specified startup commands
            await this.executeSilently(session, this.getUserStartupCommands(), {
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
            promises.push(session.requestKernelInfo().then((item) => item?.content));
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
            await session.waitForIdle(this.launchTimeout, this.startCancellation.token);
            traceVerbose('End running kernel initialization, session is idle');
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
            if (!this.configService.getSettings(undefined).enableExtendedKernelCompletions) {
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

        const settings = this.configService.getSettings(this.resourceUri);
        if (settings && settings.themeMatplotlibPlots) {
            // We're theming matplotlibs, so we have to setup our default state.
            traceInfoIfCI(`Initialize config for plots for ${getDisplayPath(this.resourceUri || this.uri)}`);

            const matplotInit = CodeSnippets.MatplotLibInit;

            traceInfo(`Initialize matplotlib for ${getDisplayPath(this.resourceUri || this.uri)}`);
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

    protected getUserStartupCommands(): string[] {
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

    protected async executeSilently(
        session: IKernelConnectionSession,
        code: string[],
        errorOptions?: SilentExecutionErrorOptions
    ) {
        if (!session || code.join('').trim().length === 0) {
            traceVerbose(`Not executing startup session: ${session ? 'Object' : 'undefined'}, code: ${code}`);
            return;
        }
        await executeSilently(session, code.join('\n'), errorOptions);
    }
}

export class ThirdPartyKernel extends BaseKernel<ThirdPartyKernelExecution> {
    public override get creator(): '3rdPartyExtension' {
        return '3rdPartyExtension';
    }
    constructor(
        uri: Uri,
        resourceUri: Resource,
        kernelConnectionMetadata: Readonly<KernelConnectionMetadata>,
        notebookProvider: INotebookProvider,
        launchTimeout: number,
        interruptTimeout: number,
        appShell: IApplicationShell,
        configService: IConfigurationService,
        statusProvider: IStatusProvider,
        startupCodeProviders: IStartupCodeProvider[]
    ) {
        super(
            uri,
            resourceUri,
            kernelConnectionMetadata,
            notebookProvider,
            launchTimeout,
            interruptTimeout,
            appShell,
            configService,
            statusProvider,
            startupCodeProviders,
            '3rdPartyExtension'
        );
        this.kernelExecution = new ThirdPartyKernelExecution(this, this.interruptTimeout);
        this.disposables.push(this.kernelExecution);
    }
}

/**
 * Represents an active kernel process running on the jupyter (or local) machine.
 */
export class Kernel extends BaseKernel<KernelExecution> implements IKernel {
    public override get creator(): 'jupyterExtension' {
        return 'jupyterExtension';
    }

    get onPreExecute(): Event<NotebookCell> {
        return this._onPreExecute.event;
    }
    get executionCount(): number {
        return this._visibleExecutionCount;
    }
    private _visibleExecutionCount = 0;
    private readonly _onPreExecute = new EventEmitter<NotebookCell>();
    private perceivedJupyterStartupTelemetryCaptured?: boolean;
    constructor(
        uri: Uri,
        resourceUri: Resource,
        public readonly notebook: NotebookDocument,
        kernelConnectionMetadata: Readonly<KernelConnectionMetadata>,
        notebookProvider: INotebookProvider,
        launchTimeout: number,
        interruptTimeout: number,
        appShell: IApplicationShell,
        public readonly controller: NotebookController,
        configService: IConfigurationService,
        outputTracker: CellOutputDisplayIdTracker,
        statusProvider: IStatusProvider,
        context: IExtensionContext,
        formatters: ITracebackFormatter[],
        startupCodeProviders: IStartupCodeProvider[],
        private readonly sendTelemetryForPythonKernelExecutable: () => Promise<void>
    ) {
        super(
            uri,
            resourceUri,
            kernelConnectionMetadata,
            notebookProvider,
            launchTimeout,
            interruptTimeout,
            appShell,
            configService,
            statusProvider,
            startupCodeProviders,
            'jupyterExtension'
        );

        this.kernelExecution = new KernelExecution(
            this,
            appShell,
            interruptTimeout,
            outputTracker,
            context,
            formatters
        );
        this.kernelExecution.onPreExecute((c) => this._onPreExecute.fire(c), this, this.disposables);
        this.disposables.push(this.kernelExecution);
        this.disposables.push(this._onPreExecute);
        this.disposables.push(this.kernelExecution);
    }
    public get pendingCells(): readonly NotebookCell[] {
        return this.kernelExecution.queue;
    }
    public async executeCell(cell: NotebookCell, codeOverride?: string): Promise<NotebookCellRunState> {
        traceCellMessage(cell, `kernel.executeCell, ${getDisplayPath(cell.notebook.uri)}`);
        initializeInteractiveOrNotebookTelemetryBasedOnUserAction(this.resourceUri, this.kernelConnectionMetadata);
        sendKernelTelemetryEvent(this.resourceUri, Telemetry.ExecuteCell);
        this.sendKernelStartedTelemetry();
        const stopWatch = new StopWatch();
        const sessionPromise = this.startJupyterSession();
        const promise = this.kernelExecution.executeCell(sessionPromise, cell, codeOverride);
        this.trackNotebookCellPerceivedColdTime(stopWatch, sessionPromise, promise).catch(noop);
        promise.finally(() => (this._visibleExecutionCount += 1));
        promise.then((state) => traceInfo(`Cell ${cell.index} executed with state ${state}`), noop);
        return promise;
    }
    public async executeHidden(code: string): Promise<nbformat.IOutput[]> {
        const stopWatch = new StopWatch();
        const sessionPromise = this.startJupyterSession();
        const promise = sessionPromise.then((session) => executeSilently(session, code));
        this.trackNotebookCellPerceivedColdTime(stopWatch, sessionPromise, promise).catch(noop);
        return promise;
    }
    protected async trackNotebookCellPerceivedColdTime(
        stopWatch: StopWatch,
        started: Promise<unknown>,
        executionPromise: Promise<unknown>
    ): Promise<void> {
        if (this.perceivedJupyterStartupTelemetryCaptured) {
            return;
        }
        const session = await started;
        if (!session) {
            return;
        }
        // Setup telemetry
        if (!this.perceivedJupyterStartupTelemetryCaptured) {
            this.perceivedJupyterStartupTelemetryCaptured = true;
            sendKernelTelemetryEvent(
                this.resourceUri,
                Telemetry.PerceivedJupyterStartupNotebook,
                stopWatch.elapsedTime
            );
            executionPromise
                .finally(() =>
                    sendKernelTelemetryEvent(
                        this.resourceUri,
                        Telemetry.StartExecuteNotebookCellPerceivedCold,
                        stopWatch.elapsedTime
                    )
                )
                .catch(noop);
        }
    }
    protected override async initializeAfterStart(session: IKernelConnectionSession | undefined) {
        this._visibleExecutionCount = 0;
        if (session && isPythonKernelConnection(this.kernelConnectionMetadata)) {
            // Request completions to warm up the completion engine.
            this.requestEmptyCompletions(session);

            if (isLocalConnection(this.kernelConnectionMetadata)) {
                await this.sendTelemetryForPythonKernelExecutable();
            }
        }
        return super.initializeAfterStart(session);
    }

    /**
     * Do not wait for completions,
     * If the completions request crashes then we don't get a response for this request,
     * Hence we end up waiting indefinitely.
     * https://github.com/microsoft/vscode-jupyter/issues/9014
     */
    private requestEmptyCompletions(session: IKernelConnectionSession) {
        session
            ?.requestComplete({
                code: '__file__.',
                cursor_pos: 9
            })
            .ignoreErrors();
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
