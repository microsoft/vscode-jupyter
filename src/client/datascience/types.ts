// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import type * as nbformat from '@jupyterlab/nbformat';
import type { Session } from '@jupyterlab/services';
import type { Kernel, KernelMessage } from '@jupyterlab/services/lib/kernel';
import type { JSONObject } from '@lumino/coreutils';
import { Observable } from 'rxjs/Observable';
import { SemVer } from 'semver';
import {
    CancellationToken,
    CodeLens,
    CodeLensProvider,
    DebugConfiguration,
    DebugSession,
    Disposable,
    Event,
    NotebookCell,
    NotebookDocument,
    NotebookEditor,
    QuickPickItem,
    Range,
    TextDocument,
    TextEditor,
    Uri,
    WebviewViewProvider
} from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import type { Data as WebSocketData } from 'ws';
import { ICommandManager, IDebugService } from '../common/application/types';
import { ExecutionResult, ObservableExecutionResult, SpawnOptions } from '../common/process/types';
import { IAsyncDisposable, IDisposable, IJupyterSettings, InteractiveWindowMode, Resource } from '../common/types';
import { StopWatch } from '../common/utils/stopWatch';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { JupyterCommands } from './constants';
import { IDataViewerDataProvider } from './data-viewing/types';
import { JupyterServerInfo } from './jupyter/jupyterConnection';
import { JupyterInstallError } from './errors/jupyterInstallError';
import { IKernel, KernelConnectionMetadata } from './jupyter/kernels/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PromiseFunction = (...any: any[]) => Promise<any>;

// Main interface
export const IDataScience = Symbol('IDataScience');
export interface IDataScience extends Disposable {
    activate(): Promise<void>;
}

export const IDataScienceCommandListener = Symbol('IDataScienceCommandListener');
export interface IDataScienceCommandListener {
    register(commandManager: ICommandManager): void;
}

export interface IRawConnection {
    readonly type: 'raw';
    readonly localLaunch: true;
    readonly valid: boolean;
    readonly displayName: string;
}

export interface IJupyterConnection extends Disposable {
    readonly type: 'jupyter';
    readonly localLaunch: boolean;
    readonly valid: boolean;
    readonly displayName: string;
    disconnected: Event<number>;

    // Jupyter specific members
    readonly baseUrl: string;
    readonly token: string;
    readonly hostName: string;
    localProcExitCode: number | undefined;
    readonly rootDirectory: string; // Directory where the notebook server was started.
    readonly url?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getAuthHeader?(): any; // Snould be a json object
}

export type INotebookProviderConnection = IRawConnection | IJupyterConnection;

export enum InterruptResult {
    Success = 'success',
    TimedOut = 'timeout',
    Restarted = 'restart'
}

// Information used to launch a jupyter notebook server

// Information used to launch a notebook server
export interface INotebookServerLaunchInfo {
    connectionInfo: IJupyterConnection;
    uri: string | undefined; // Different from the connectionInfo as this is the setting used, not the result
    workingDir: string | undefined;
    purpose: string | undefined; // Purpose this server is for
    disableUI?: boolean; // True if no UI should be brought up during the launch
}

export interface INotebookCompletion {
    matches: ReadonlyArray<string>;
    cursor: {
        start: number;
        end: number;
    };
    metadata: {
        _jupyter_types_experimental?: { end: number; start: number; text: string; type?: string }[];
    };
}

// Talks to a jupyter ipython kernel to retrieve data for cells
export const INotebookServer = Symbol('INotebookServer');
export interface INotebookServer extends IAsyncDisposable {
    createNotebook(
        resource: Resource,
        kernelConnection: KernelConnectionMetadata,
        cancelToken?: CancellationToken
    ): Promise<INotebook>;
    connect(launchInfo: INotebookServerLaunchInfo, cancelToken?: CancellationToken): Promise<void>;
    getConnectionInfo(): IJupyterConnection | undefined;
}

// Provides a service to determine if raw notebook is supported or not
export const IRawNotebookSupportedService = Symbol('IRawNotebookSupportedService');
export interface IRawNotebookSupportedService {
    isSupported: boolean;
}

// Provides notebooks that talk directly to kernels as opposed to a jupyter server
export const IRawNotebookProvider = Symbol('IRawNotebookProvider');
export interface IRawNotebookProvider extends IAsyncDisposable {
    isSupported: boolean;
    connect(connect: ConnectNotebookProviderOptions): Promise<IRawConnection | undefined>;
    createNotebook(
        document: NotebookDocument,
        resource: Resource,
        kernelConnection: KernelConnectionMetadata,
        disableUI?: boolean,
        cancelToken?: CancellationToken
    ): Promise<INotebook>;
}

// Provides notebooks that talk to jupyter servers
export const IJupyterNotebookProvider = Symbol('IJupyterNotebookProvider');
export interface IJupyterNotebookProvider {
    connect(options: ConnectNotebookProviderOptions): Promise<IJupyterConnection | undefined>;
    createNotebook(options: NotebookCreationOptions): Promise<INotebook>;
    disconnect(options: ConnectNotebookProviderOptions): Promise<void>;
}

export interface INotebook {
    readonly connection: INotebookProviderConnection | undefined;
    readonly session: IJupyterSession; // Temporary. This just makes it easier to write a notebook that works with VS code types.
}

// Options for connecting to a notebook provider
export type ConnectNotebookProviderOptions = {
    getOnly?: boolean;
    disableUI?: boolean;
    localOnly?: boolean;
    token?: CancellationToken;
    resource: Resource;
};

export interface INotebookServerOptions {
    uri?: string;
    resource: Resource;
    usingDarkTheme?: boolean;
    skipUsingDefaultConfig?: boolean;
    workingDir?: string;
    purpose: string;
    allowUI(): boolean;
}

export const IJupyterExecution = Symbol('IJupyterExecution');
export interface IJupyterExecution extends IAsyncDisposable {
    isNotebookSupported(cancelToken?: CancellationToken): Promise<boolean>;
    connectToNotebookServer(
        options?: INotebookServerOptions,
        cancelToken?: CancellationToken
    ): Promise<INotebookServer | undefined>;
    getUsableJupyterPython(cancelToken?: CancellationToken): Promise<PythonEnvironment | undefined>;
    getServer(options?: INotebookServerOptions): Promise<INotebookServer | undefined>;
    getNotebookError(): Promise<string>;
    refreshCommands(): Promise<void>;
}

export const IInteractiveWindowDebugger = Symbol('IInteractiveWindowDebugger');
export interface IInteractiveWindowDebugger {
    attach(kernel: IKernel): Promise<void>;
    detach(kernel: IKernel): Promise<void>;
    enable(kernel: IKernel): void;
    disable(kernel: IKernel): void;
}

export interface IJupyterPasswordConnectInfo {
    requestHeaders?: HeadersInit;
    remappedBaseUrl?: string;
    remappedToken?: string;
}

export const IJupyterPasswordConnect = Symbol('IJupyterPasswordConnect');
export interface IJupyterPasswordConnect {
    getPasswordConnectionInfo(url: string): Promise<IJupyterPasswordConnectInfo | undefined>;
}

export const IJupyterSession = Symbol('IJupyterSession');
/**
 * Closely represents Jupyter Labs Kernel.IKernelConnection.
 */
export interface IJupyterSession extends IAsyncDisposable {
    readonly disposed: boolean;
    readonly status: KernelMessage.Status;
    readonly kernelSocket: Observable<KernelSocketInformation | undefined>;
    onSessionStatusChanged: Event<KernelMessage.Status>;
    onDidDispose: Event<void>;
    onIOPubMessage: Event<KernelMessage.IIOPubMessage>;
    interrupt(): Promise<void>;
    restart(): Promise<void>;
    waitForIdle(timeout: number): Promise<void>;
    requestExecute(
        content: KernelMessage.IExecuteRequestMsg['content'],
        disposeOnDone?: boolean,
        metadata?: JSONObject
    ): Kernel.IShellFuture<KernelMessage.IExecuteRequestMsg, KernelMessage.IExecuteReplyMsg>;
    requestDebug(
        content: KernelMessage.IDebugRequestMsg['content'],
        disposeOnDone?: boolean
    ): Kernel.IControlFuture<KernelMessage.IDebugRequestMsg, KernelMessage.IDebugReplyMsg>;
    requestComplete(content: KernelMessage.ICompleteRequestMsg['content']): Promise<KernelMessage.ICompleteReplyMsg>;
    requestInspect(content: KernelMessage.IInspectRequestMsg['content']): Promise<KernelMessage.IInspectReplyMsg>;
    sendInputReply(content: KernelMessage.IInputReply): void;
    registerCommTarget(
        targetName: string,
        callback: (comm: Kernel.IComm, msg: KernelMessage.ICommOpenMsg) => void | PromiseLike<void>
    ): void;
    registerMessageHook(
        msgId: string,
        hook: (msg: KernelMessage.IIOPubMessage) => boolean | PromiseLike<boolean>
    ): void;
    removeMessageHook(msgId: string, hook: (msg: KernelMessage.IIOPubMessage) => boolean | PromiseLike<boolean>): void;
    requestKernelInfo(): Promise<KernelMessage.IInfoReplyMsg | undefined>;
    shutdown(): Promise<void>;
}

export type ISessionWithSocket = Session.ISessionConnection & {
    /**
     * The resource associated with this session.
     */
    resource: Resource;
    /**
     * Whether this is a remote session that we attached to.
     */
    isRemoteSession?: boolean;
    /**
     * Socket information used for hooking messages to the kernel.
     */
    kernelSocketInformation: KernelSocketInformation;
    kernelConnectionMetadata: KernelConnectionMetadata;
};

export const IJupyterSessionManagerFactory = Symbol('IJupyterSessionManagerFactory');
export interface IJupyterSessionManagerFactory {
    readonly onRestartSessionCreated: Event<Kernel.IKernelConnection>;
    readonly onRestartSessionUsed: Event<Kernel.IKernelConnection>;
    create(connInfo: IJupyterConnection, failOnPassword?: boolean): Promise<IJupyterSessionManager>;
}

export interface IJupyterSessionManager extends IAsyncDisposable {
    readonly onRestartSessionCreated: Event<Kernel.IKernelConnection>;
    readonly onRestartSessionUsed: Event<Kernel.IKernelConnection>;
    startNew(
        resource: Resource,
        kernelConnection: KernelConnectionMetadata,
        workingDirectory: string,
        cancelToken?: CancellationToken,
        disableUI?: boolean
    ): Promise<IJupyterSession>;
    getKernelSpecs(): Promise<IJupyterKernelSpec[]>;
    getRunningKernels(): Promise<IJupyterKernel[]>;
    getRunningSessions(): Promise<Session.IModel[]>;
}

export interface IJupyterKernel {
    /**
     * Id of an existing (active) Kernel from an active session.
     *
     * @type {string}
     * @memberof IJupyterKernel
     */
    id?: string;
    name: string;
    lastActivityTime: Date;
    numberOfConnections: number;
}

export interface IJupyterKernelSpec {
    /**
     * Id of an existing (active) Kernel from an active session.
     *
     * @type {string}
     * @memberof IJupyterKernel
     */
    id?: string;
    name: string;
    language?: string;
    path: string;
    env?: NodeJS.ProcessEnv | undefined;
    /**
     * Kernel display name.
     *
     * @type {string}
     * @memberof IJupyterKernelSpec
     */
    readonly display_name: string;
    /**
     * A dictionary of additional attributes about this kernel; used by clients to aid in kernel selection.
     * Optionally storing the interpreter information in the metadata (helping extension search for kernels that match an interpereter).
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly metadata?: Record<string, any> & { interpreter?: Partial<PythonEnvironment>; originalSpecFile?: string };
    readonly argv: string[];
    /**
     * Optionally where this kernel spec json is located on the local FS.
     */
    specFile?: string;
    /**
     * Optionally the Interpreter this kernel spec belongs to.
     * You can have kernel specs that are scoped to an interpreter.
     * E.g. if you have Python in `c:\Python\Python3.8`
     * Then you could have kernels in `<sys.prefix folder for this interpreter>\share\jupyter\kernels`
     * Plenty of conda packages ship kernels in this manner (beakerx, etc).
     */
    interpreterPath?: string;
    readonly interrupt_mode?: 'message' | 'signal';
}

export const INotebookImporter = Symbol('INotebookImporter');
export interface INotebookImporter extends Disposable {
    importFromFile(contentsFile: Uri, interpreter: PythonEnvironment): Promise<string>;
}

export const INotebookExporter = Symbol('INotebookExporter');
export interface INotebookExporter extends Disposable {
    translateToNotebook(
        cells: ICell[],
        directoryChange?: string,
        kernelSpec?: nbformat.IKernelspecMetadata
    ): Promise<nbformat.INotebookContent | undefined>;
    exportToFile(cells: ICell[], file: string, showOpenPrompt?: boolean): Promise<void>;
}

export const IInteractiveWindowProvider = Symbol('IInteractiveWindowProvider');
export interface IInteractiveWindowProvider {
    /**
     * The active interactive window if it has the focus.
     */
    readonly activeWindow: IInteractiveWindow | undefined;
    /**
     * List of open interactive windows
     */
    readonly windows: ReadonlyArray<IInteractiveWindow>;
    /**
     * Event fired when the active interactive window changes
     */
    readonly onDidChangeActiveInteractiveWindow: Event<IInteractiveWindow | undefined>;
    /**
     * Event fired when an interactive window is created
     */
    readonly onDidCreateInteractiveWindow: Event<IInteractiveWindow>;
    /**
     * Gets or creates a new interactive window and associates it with the owner. If no owner, marks as a non associated.
     * @param owner file that started this interactive window
     */
    getOrCreate(owner: Resource): Promise<IInteractiveWindow>;
    /**
     * Given a text document, return the associated interactive window if one exists.
     * @param owner The URI of a text document which may be associated with an interactive window.
     */
    get(owner: Uri): IInteractiveWindow | undefined;
}

export const IDataScienceErrorHandler = Symbol('IDataScienceErrorHandler');
export interface IDataScienceErrorHandler {
    /**
     * Handles the errors and if necessary displays an error message.
     * The value of `context` is used to determine the context of the error message, whether it applies to starting or interrupting kernels or the like.
     * Thus based on the context the error message would be different.
     */
    handleError(err: Error): Promise<void>;
    /**
     * Handles errors specific to kernels.
     */
    handleKernelError(
        err: Error,
        context: 'start' | 'restart' | 'interrupt' | 'execution',
        kernelConnection: KernelConnectionMetadata
    ): Promise<void>;
}

/**
 * Given a local resource this will convert the Uri into a form such that it can be used in a WebView.
 */
export interface ILocalResourceUriConverter {
    /**
     * Root folder that scripts should be copied to.
     */
    readonly rootScriptFolder: Uri;
    /**
     * Convert a uri for the local file system to one that can be used inside webviews.
     *
     * Webviews cannot directly load resources from the workspace or local file system using `file:` uris. The
     * `asWebviewUri` function takes a local `file:` uri and converts it into a uri that can be used inside of
     * a webview to load the same resource:
     *
     * ```ts
     * webview.html = `<img src="${webview.asWebviewUri(vscode.Uri.file('/Users/codey/workspace/cat.gif'))}">`
     * ```
     */
    asWebviewUri(localResource: Uri): Promise<Uri>;
}

export interface IInteractiveBase extends Disposable {
    hasCell(id: string): Promise<boolean>;
}

export interface IInteractiveWindow extends IInteractiveBase {
    readonly onDidChangeViewState: Event<void>;
    readonly notebookEditor: NotebookEditor | undefined;
    readonly owner: Resource;
    readonly submitters: Uri[];
    readonly notebookUri?: Uri;
    readonly inputUri?: Uri;
    readonly notebookDocument?: NotebookDocument;
    readonly readyPromise: Promise<void>;
    readonly kernelPromise: Promise<IKernel | undefined>;
    closed: Event<void>;
    addCode(code: string, file: Uri, line: number, editor?: TextEditor, runningStopWatch?: StopWatch): Promise<boolean>;
    addMessage(message: string): Promise<void>;
    debugCode(
        code: string,
        file: Uri,
        line: number,
        editor?: TextEditor,
        runningStopWatch?: StopWatch
    ): Promise<boolean>;
    expandAllCells(): Promise<void>;
    collapseAllCells(): Promise<void>;
    scrollToCell(id: string): void;
    exportAs(cells?: ICell[]): void;
    export(cells?: ICell[]): void;
}

export interface IInteractiveWindowLoadable extends IInteractiveWindow {
    changeMode(newMode: InteractiveWindowMode): void;
}

// For native editing, the provider acts like the IDocumentManager for normal docs
export const INotebookEditorProvider = Symbol('INotebookEditorProvider');
export interface INotebookEditorProvider {
    open(file: Uri): Promise<void>;
    createNew(options?: { contents?: string; defaultCellLanguage?: string }): Promise<void>;
}

// Wraps the vscode CodeLensProvider base class
export const IDataScienceCodeLensProvider = Symbol('IDataScienceCodeLensProvider');
export interface IDataScienceCodeLensProvider extends CodeLensProvider {
    getCodeWatcher(document: TextDocument): ICodeWatcher | undefined;
}

// Wraps the Code Watcher API
export const ICodeWatcher = Symbol('ICodeWatcher');
export interface ICodeWatcher extends IDisposable {
    readonly uri: Uri | undefined;
    codeLensUpdated: Event<void>;
    setDocument(document: TextDocument): void;
    getVersion(): number;
    getCodeLenses(): CodeLens[];
    getCachedSettings(): IJupyterSettings | undefined;
    runAllCells(): Promise<void>;
    runCell(range: Range): Promise<void>;
    debugCell(range: Range): Promise<void>;
    runCurrentCell(): Promise<void>;
    runCurrentCellAndAdvance(): Promise<void>;
    runSelectionOrLine(activeEditor: TextEditor | undefined, text: string | undefined): Promise<void>;
    runToLine(targetLine: number): Promise<void>;
    runFromLine(targetLine: number): Promise<void>;
    runAllCellsAbove(stopLine: number, stopCharacter: number): Promise<void>;
    runCellAndAllBelow(startLine: number, startCharacter: number): Promise<void>;
    runFileInteractive(): Promise<void>;
    debugFileInteractive(): Promise<void>;
    addEmptyCellToBottom(): Promise<void>;
    runCurrentCellAndAddBelow(): Promise<void>;
    insertCellBelowPosition(): void;
    insertCellBelow(): void;
    insertCellAbove(): void;
    deleteCells(): void;
    selectCell(): void;
    selectCellContents(): void;
    extendSelectionByCellAbove(): void;
    extendSelectionByCellBelow(): void;
    moveCellsUp(): Promise<void>;
    moveCellsDown(): Promise<void>;
    changeCellToMarkdown(): void;
    changeCellToCode(): void;
    debugCurrentCell(): Promise<void>;
    gotoNextCell(): void;
    gotoPreviousCell(): void;
}

export const ICodeLensFactory = Symbol('ICodeLensFactory');
export interface ICodeLensFactory {
    updateRequired: Event<void>;
    createCodeLenses(document: TextDocument): CodeLens[];
    getCellRanges(document: TextDocument): ICellRange[];
}

// Basic structure for a cell from a notebook
export interface ICell {
    file?: string;
    data: nbformat.ICodeCell | nbformat.IRawCell | nbformat.IMarkdownCell;
}

// CellRange is used as the basis for creating new ICells.
// Was only intended to aggregate together ranges to create an ICell
// However the "range" aspect is useful when working with plain text document
// Ultimately, it would probably be ideal to be ICell and change line to range.
// Specificially see how this is being used for the ICodeLensFactory to
// provide cells for the CodeWatcher to use.
export interface ICellRange {
    range: Range;
    title: string;
    cell_type: string;
}

export const ICodeCssGenerator = Symbol('ICodeCssGenerator');
export interface ICodeCssGenerator {
    generateThemeCss(resource: Resource, isDark: boolean, theme: string): Promise<string>;
}

export const IThemeFinder = Symbol('IThemeFinder');
export interface IThemeFinder {
    findThemeRootJson(themeName: string): Promise<string | undefined>;
    isThemeDark(themeName: string): Promise<boolean | undefined>;
}

export const IStatusProvider = Symbol('IStatusProvider');
export interface IStatusProvider {
    // call this function to set the new status on the active
    // interactive window. Dispose of the returned object when done.
    set(message: string, timeout?: number, canceled?: () => void): Disposable;

    // call this function to wait for a promise while displaying status
    waitWithStatus<T>(promise: () => Promise<T>, message: string, timeout?: number, canceled?: () => void): Promise<T>;
}

export interface IJupyterCommand {
    interpreter(): Promise<PythonEnvironment | undefined>;
    exec(args: string[], options: SpawnOptions): Promise<ExecutionResult<string>>;
}

export const IJupyterCommandFactory = Symbol('IJupyterCommandFactory');
export interface IJupyterCommandFactory {
    createInterpreterCommand(
        command: JupyterCommands,
        moduleName: string,
        args: string[],
        interpreter: PythonEnvironment,
        isActiveInterpreter: boolean
    ): IJupyterCommand;
}

export interface IJupyterExtraSettings extends IJupyterSettings {
    extraSettings: {
        editor: {
            cursor: string;
            cursorBlink: string;
            fontLigatures: boolean;
            autoClosingBrackets: string;
            autoClosingQuotes: string;
            autoSurround: string;
            autoIndent: boolean;
            scrollBeyondLastLine: boolean;
            horizontalScrollbarSize: number;
            verticalScrollbarSize: number;
            fontSize: number;
            fontFamily: string;
        };
        theme: string;
        hasPythonExtension: boolean;
    };
}

// Get variables from the currently running active Jupyter server or debugger
// Note: This definition is used implicitly by getJupyterVariableValue.py file
// Changes here may need to be reflected there as well
export interface IJupyterVariable {
    name: string;
    value: string | undefined;
    executionCount?: number;
    supportsDataExplorer: boolean;
    type: string;
    size: number;
    shape: string;
    dataDimensionality?: number;
    count: number;
    truncated: boolean;
    columns?: { key: string; type: string }[];
    rowCount?: number;
    indexColumn?: string;
    maximumRowChunkSize?: number;
    fileName?: string;
}

export const IJupyterVariableDataProvider = Symbol('IJupyterVariableDataProvider');
export interface IJupyterVariableDataProvider extends IDataViewerDataProvider {
    readonly kernel: IKernel | undefined;
    setDependencies(variable: IJupyterVariable, kernel?: IKernel): void;
}

export const IJupyterVariableDataProviderFactory = Symbol('IJupyterVariableDataProviderFactory');
export interface IJupyterVariableDataProviderFactory {
    create(variable: IJupyterVariable, kernel?: IKernel): Promise<IJupyterVariableDataProvider>;
}

export const IJupyterVariables = Symbol('IJupyterVariables');
export interface IJupyterVariables {
    readonly refreshRequired: Event<void>;
    getVariables(request: IJupyterVariablesRequest, kernel?: IKernel): Promise<IJupyterVariablesResponse>;
    getFullVariable(
        variable: IJupyterVariable,
        kernel?: IKernel,
        cancelToken?: CancellationToken
    ): Promise<IJupyterVariable>;
    getDataFrameInfo(
        targetVariable: IJupyterVariable,
        kernel?: IKernel,
        sliceExpression?: string,
        isRefresh?: boolean
    ): Promise<IJupyterVariable>;
    getDataFrameRows(
        targetVariable: IJupyterVariable,
        start: number,
        end: number,
        kernel?: IKernel,
        sliceExpression?: string
    ): Promise<JSONObject>;
    getMatchingVariable(
        name: string,
        kernel?: IKernel,
        cancelToken?: CancellationToken
    ): Promise<IJupyterVariable | undefined>;
    // This is currently only defined in kernelVariables.ts
    getVariableProperties?(name: string, kernel?: IKernel, cancelToken?: CancellationToken): Promise<JSONObject>;
}

export interface IConditionalJupyterVariables extends IJupyterVariables {
    readonly active: boolean;
}

// Request for variables
export interface IJupyterVariablesRequest {
    executionCount: number;
    refreshCount: number;
    sortColumn: string;
    sortAscending: boolean;
    startIndex: number;
    pageSize: number;
}

// Response to a request
export interface IJupyterVariablesResponse {
    executionCount: number;
    totalCount: number;
    pageStartIndex: number;
    pageResponse: IJupyterVariable[];
    refreshCount: number;
}

export const IPlotViewerProvider = Symbol('IPlotViewerProvider');
export interface IPlotViewerProvider {
    showPlot(imageHtml: string): Promise<void>;
}
export const IPlotViewer = Symbol('IPlotViewer');

export interface IPlotViewer extends IDisposable {
    closed: Event<IPlotViewer>;
    removed: Event<number>;
    addPlot(imageHtml: string): Promise<void>;
    show(): Promise<void>;
}

export interface ISourceMapMapping {
    line: number;
    endLine: number;
    runtimeSource: { path: string };
    runtimeLine: number;
}

export interface ISourceMapRequest {
    source: { path: string };
    pydevdSourceMaps: ISourceMapMapping[];
}

export interface ICellHash {
    line: number; // 1 based
    endLine: number; // 1 based and inclusive
    runtimeLine: number; // Line in the jupyter source to start at
    hash: string;
    runtimeFile: string; // Name of the cell's file
    executionCount: number;
    id: string; // Cell id as sent to jupyter
    timestamp: number;
    code: string; // Code that was actually hashed (might include breakpoint)
}

export interface IFileHashes {
    file: string;
    hashes: ICellHash[];
}

export const ICellHashListener = Symbol('ICellHashListener');
export interface ICellHashListener {
    hashesUpdated(hashes: IFileHashes[]): Promise<void>;
}

export interface ICellHashProvider {
    updated: Event<void>;
    getHashes(): IFileHashes[];
    getExecutionCount(): number;
    incExecutionCount(): void;
    addCellHash(notebookCell: NotebookCell): Promise<ICellHash | undefined>;
    /**
     * This function will modify a traceback from an error message.
     * Tracebacks take a form like so:
     * "[1;31m---------------------------------------------------------------------------[0m"
     * "[1;31mZeroDivisionError[0m                         Traceback (most recent call last)"
     * "[1;32md:\Training\SnakePython\foo.py[0m in [0;36m<module>[1;34m[0m\n[0;32m      1[0m [0mprint[0m[1;33m([0m[1;34m'some more'[0m[1;33m)[0m[1;33m[0m[1;33m[0m[0m\n    [1;32m----> 2[1;33m [0mcause_error[0m[1;33m([0m[1;33m)[0m[1;33m[0m[1;33m[0m[0m\n    [0m"
     * "[1;32md:\Training\SnakePython\foo.py[0m in [0;36mcause_error[1;34m()[0m\n[0;32m      3[0m     [0mprint[0m[1;33m([0m[1;34m'error'[0m[1;33m)[0m[1;33m[0m[1;33m[0m[0m\n    [0;32m      4[0m     [0mprint[0m[1;33m([0m[1;34m'now'[0m[1;33m)[0m[1;33m[0m[1;33m[0m[0m\n    [1;32m----> 5[1;33m     [0mprint[0m[1;33m([0m [1;36m1[0m [1;33m/[0m [1;36m0[0m[1;33m)[0m[1;33m[0m[1;33m[0m[0m\n    [0m"
     * "[1;31mZeroDivisionError[0m: division by zero"
     * Each item in the array being a stack frame.
     */
    modifyTraceback(traceback: string[]): string[];
}

export interface IDebugLocation {
    fileName: string;
    lineNumber: number;
    column: number;
}

export const IDebugLocationTracker = Symbol('IDebugLocationTracker');
export interface IDebugLocationTracker {
    updated: Event<void>;
    getLocation(debugSession: DebugSession): IDebugLocation | undefined;
}

export const IJupyterSubCommandExecutionService = Symbol('IJupyterSubCommandExecutionService');
/**
 * Responsible for execution of jupyter subcommands such as `notebook`, `nbconvert`, etc.
 * The executed code is as follows `python -m jupyter <subcommand>`.
 *
 * @export
 * @interface IJupyterSubCommandExecutionService
 */
export interface IJupyterSubCommandExecutionService {
    /**
     * Checks whether notebook is supported.
     *
     * @param {CancellationToken} [cancelToken]
     * @returns {Promise<boolean>}
     * @memberof IJupyterSubCommandExecutionService
     */
    isNotebookSupported(cancelToken?: CancellationToken): Promise<boolean>;
    /**
     * Error message indicating why jupyter notebook isn't supported.
     *
     * @returns {Promise<string>}
     * @memberof IJupyterSubCommandExecutionService
     */
    getReasonForJupyterNotebookNotBeingSupported(): Promise<string>;
    /**
     * Used to refresh the command finder.
     *
     * @returns {Promise<void>}
     * @memberof IJupyterSubCommandExecutionService
     */
    refreshCommands(): Promise<void>;
    /**
     * Gets the interpreter to be used for starting of jupyter server.
     *
     * @param {CancellationToken} [token]
     * @returns {(Promise<PythonEnvironment | undefined>)}
     * @memberof IJupyterInterpreterService
     */
    getSelectedInterpreter(token?: CancellationToken): Promise<PythonEnvironment | undefined>;
    /**
     * Starts the jupyter notebook server
     *
     * @param {string[]} notebookArgs
     * @param {SpawnOptions} options
     * @returns {Promise<ObservableExecutionResult<string>>}
     * @memberof IJupyterSubCommandExecutionService
     */
    startNotebook(notebookArgs: string[], options: SpawnOptions): Promise<ObservableExecutionResult<string>>;
    /**
     * Gets a list of all locally running jupyter notebook servers.
     *
     * @param {CancellationToken} [token]
     * @returns {(Promise<JupyterServerInfo[] | undefined>)}
     * @memberof IJupyterSubCommandExecutionService
     */
    getRunningJupyterServers(token?: CancellationToken): Promise<JupyterServerInfo[] | undefined>;
}

export const IJupyterInterpreterDependencyManager = Symbol('IJupyterInterpreterDependencyManager');
export interface IJupyterInterpreterDependencyManager {
    /**
     * Installs the dependencies required to launch jupyter.
     *
     * @param {JupyterInstallError} [err]
     * @returns {Promise<void>}
     * @memberof IJupyterInterpreterDependencyManager
     */
    installMissingDependencies(err?: JupyterInstallError): Promise<void>;
}

export const INbConvertInterpreterDependencyChecker = Symbol('INbConvertInterpreterDependencyChecker');
export interface INbConvertInterpreterDependencyChecker {
    isNbConvertInstalled(interpreter: PythonEnvironment, _token?: CancellationToken): Promise<boolean>;
    getNbConvertVersion(interpreter: PythonEnvironment, _token?: CancellationToken): Promise<SemVer | undefined>;
}

export const INbConvertExportToPythonService = Symbol('INbConvertExportToPythonService');
export interface INbConvertExportToPythonService {
    exportNotebookToPython(
        file: Uri,
        interpreter: PythonEnvironment,
        template?: string,
        token?: CancellationToken
    ): Promise<string>;
}

type WebViewViewState = {
    readonly visible: boolean;
    readonly active: boolean;
};
export type WebViewViewChangeEventArgs = { current: WebViewViewState; previous: WebViewViewState };

export type GetServerOptions = {
    getOnly?: boolean;
    disableUI?: boolean;
    localOnly?: boolean;
    token?: CancellationToken;
    resource: Resource;
};

/**
 * Options for getting a notebook
 */
export type NotebookCreationOptions = {
    resource: Resource;
    document: NotebookDocument;
    disableUI?: boolean;
    metadata?: nbformat.INotebookMetadata;
    kernelConnection: KernelConnectionMetadata;
    token?: CancellationToken;
};

export const INotebookProvider = Symbol('INotebookProvider');
export interface INotebookProvider {
    /**
     * Creates a notebook.
     */
    createNotebook(options: NotebookCreationOptions): Promise<INotebook | undefined>;
    /**
     * Connect to a notebook provider to prepare its connection and to get connection information
     */
    connect(options: ConnectNotebookProviderOptions): Promise<INotebookProviderConnection | undefined>;
}

export const IJupyterServerProvider = Symbol('IJupyterServerProvider');
export interface IJupyterServerProvider {
    /**
     * Gets the server used for starting notebooks
     */
    getOrCreateServer(options: GetServerOptions): Promise<INotebookServer | undefined>;
}

export interface IKernelSocket {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sendToRealKernel(data: any, cb?: (err?: Error) => void): void;
    /**
     * Adds a listener to a socket that will be called before the socket's onMessage is called. This
     * allows waiting for a callback before processing messages
     * @param listener
     */
    addReceiveHook(hook: (data: WebSocketData) => Promise<void>): void;
    /**
     * Removes a listener for the socket. When no listeners are present, the socket no longer blocks
     * @param listener
     */
    removeReceiveHook(hook: (data: WebSocketData) => Promise<void>): void;
    /**
     * Adds a hook to the sending of data from a websocket. Hooks can block sending so be careful.
     * @param patch
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addSendHook(hook: (data: any, cb?: (err?: Error) => void) => Promise<void>): void;
    /**
     * Removes a send hook from the socket.
     * @param hook
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    removeSendHook(hook: (data: any, cb?: (err?: Error) => void) => Promise<void>): void;
}

export type KernelSocketOptions = {
    /**
     * Kernel Id.
     */
    readonly id: string;
    /**
     * Kernel ClientId.
     */
    readonly clientId: string;
    /**
     * Kernel UserName.
     */
    readonly userName: string;
    /**
     * Kernel model.
     */
    readonly model: {
        /**
         * Unique identifier of the kernel server session.
         */
        readonly id: string;
        /**
         * The name of the kernel.
         */
        readonly name: string;
    };
};
export type KernelSocketInformation = {
    /**
     * Underlying socket used by jupyterlab/services to communicate with kernel.
     * See jupyterlab/services/kernel/default.ts
     */
    readonly socket?: IKernelSocket;
    /**
     * Options used to clone a kernel.
     */
    readonly options: KernelSocketOptions;
};

/**
 * Response for installation of kernel dependencies such as ipykernel.
 * (these values are used in telemetry)
 */
export enum KernelInterpreterDependencyResponse {
    ok = 0, // Used in telemetry.
    cancel = 1, // Used in telemetry.
    failed = 2, // Used in telemetry.
    selectDifferentKernel = 3 // Used in telemetry.
}

export const IKernelDependencyService = Symbol('IKernelDependencyService');
export interface IKernelDependencyService {
    installMissingDependencies(
        resource: Resource,
        interpreter: PythonEnvironment,
        token?: CancellationToken,
        disableUI?: boolean
    ): Promise<void>;
    areDependenciesInstalled(interpreter: PythonEnvironment, _token?: CancellationToken): Promise<boolean>;
}

export const IKernelVariableRequester = Symbol('IKernelVariableRequester');

export interface IKernelVariableRequester {
    getVariableNamesAndTypesFromKernel(kernel: IKernel, token?: CancellationToken): Promise<IJupyterVariable[]>;
    getFullVariable(
        targetVariable: IJupyterVariable,
        kernel: IKernel,
        token?: CancellationToken
    ): Promise<IJupyterVariable>;
    getDataFrameRows(start: number, end: number, kernel: IKernel, expression: string): Promise<{}>;
    getVariableProperties(
        word: string,
        kernel: IKernel,
        cancelToken: CancellationToken | undefined,
        matchingVariable: IJupyterVariable | undefined,
        languageSettings: { [typeNameKey: string]: string[] },
        inEnhancedTooltipsExperiment: boolean
    ): Promise<{ [attributeName: string]: string }>;
    getDataFrameInfo(targetVariable: IJupyterVariable, kernel: IKernel, expression: string): Promise<IJupyterVariable>;
}

export const INotebookCreationTracker = Symbol('INotebookCreationTracker');
export interface INotebookCreationTracker {
    readonly lastPythonNotebookCreated?: Date;
    readonly lastNotebookCreated?: Date;
    startTracking(): void;
}

export const IJupyterDebugService = Symbol('IJupyterDebugService');
export interface IJupyterDebugService extends IDebugService {
    /**
     * Event fired when a breakpoint is hit (debugger has stopped)
     */
    readonly onBreakpointHit: Event<void>;
    /**
     * Start debugging a notebook cell.
     * @param nameOrConfiguration Either the name of a debug or compound configuration or a [DebugConfiguration](#DebugConfiguration) object.
     * @return A thenable that resolves when debugging could be successfully started.
     */
    startRunByLine(config: DebugConfiguration): Thenable<boolean>;
    /**
     * Gets the current stack frame for the current thread
     */
    getStack(): Promise<DebugProtocol.StackFrame[]>;
    /**
     * Steps the current thread. Returns after the request is sent. Wait for onBreakpointHit or onDidTerminateDebugSession to determine when done.
     */
    step(): Promise<void>;
    /**
     * Runs the current thread. Will keep running until a breakpoint or end of session.
     */
    continue(): Promise<void>;
    /**
     * Force a request for variables. DebugAdapterTrackers can listen for the results.
     */
    requestVariables(): Promise<void>;
    /**
     * Stop debugging
     */
    stop(): void;
}

export interface IJupyterServerUri {
    baseUrl: string;
    token: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    authorizationHeader: any; // JSON object for authorization header.
    expiration?: Date; // Date/time when header expires and should be refreshed.
    displayName: string;
}

export type JupyterServerUriHandle = string;

export interface IJupyterUriProvider {
    readonly id: string; // Should be a unique string (like a guid)
    getQuickPickEntryItems(): QuickPickItem[];
    handleQuickPick(item: QuickPickItem, backEnabled: boolean): Promise<JupyterServerUriHandle | 'back' | undefined>;
    getServerUri(handle: JupyterServerUriHandle): Promise<IJupyterServerUri>;
}

export const IJupyterUriProviderRegistration = Symbol('IJupyterUriProviderRegistration');

export interface IJupyterUriProviderRegistration {
    getProviders(): Promise<ReadonlyArray<IJupyterUriProvider>>;
    registerProvider(picker: IJupyterUriProvider): void;
    getJupyterServerUri(id: string, handle: JupyterServerUriHandle): Promise<IJupyterServerUri>;
}

// Wraps the VS Code WebviewViewProvider. VSC Prefix as we also have our own IWebviewViewProvider
export interface IVSCWebviewViewProvider extends WebviewViewProvider {
    readonly viewType: 'jupyterViewVariables';
}

export const IJupyterServerUriStorage = Symbol('IJupyterServerUriStorage');
export interface IJupyterServerUriStorage {
    readonly onDidChangeUri: Event<void>;
    addToUriList(uri: string, time: number, displayName: string): Promise<void>;
    getSavedUriList(): Promise<{ uri: string; time: number; displayName?: string }[]>;
    clearUriList(): Promise<void>;
    getUri(): Promise<string>;
    setUri(uri: string): Promise<void>;
}
