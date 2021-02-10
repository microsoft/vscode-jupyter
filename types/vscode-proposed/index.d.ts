// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import {
    Event,
    GlobPattern,
    Uri,
    TextDocument,
    ViewColumn,
    CancellationToken,
    Disposable,
    DocumentSelector,
    ProviderResult,
    WorkspaceEditEntryMetadata,
    Command,
    AccessibilityInformation,
    AuthenticationProviderInformation,
    AuthenticationSession
} from 'vscode';

// Copy nb section from https://github.com/microsoft/vscode/blob/master/src/vs/vscode.proposed.d.ts.
/**
 * Represents a storage utility for secrets, information that is
 * sensitive.
 */
export interface SecretStorage {
    /**
     * Retrieve a secret that was stored with key. Returns undefined if there
     * is no password matching that key.
     * @param key The key the password was stored under.
     * @returns The stored value or `undefined`.
     */
    get(key: string): Thenable<string | undefined>;

    /**
     * Store a secret under a given key.
     * @param key The key to store the password under.
     * @param value The password.
     */
    store(key: string, value: string): Thenable<void>;

    /**
     * Remove a secret from storage.
     * @param key The key the password was stored under.
     */
    delete(key: string): Thenable<void>;

    /**
     * Fires when a secret is set or deleted.
     */
    onDidChange: Event<void>;
}
export interface ExtensionContext {
    secrets: SecretStorage;
}
//#region auth provider: https://github.com/microsoft/vscode/issues/88309

/**
 * An [event](#Event) which fires when an [AuthenticationProvider](#AuthenticationProvider) is added or removed.
 */
export interface AuthenticationProvidersChangeEvent {
    /**
     * The ids of the [authenticationProvider](#AuthenticationProvider)s that have been added.
     */
    readonly added: ReadonlyArray<AuthenticationProviderInformation>;

    /**
     * The ids of the [authenticationProvider](#AuthenticationProvider)s that have been removed.
     */
    readonly removed: ReadonlyArray<AuthenticationProviderInformation>;
}

/**
 * An [event](#Event) which fires when an [AuthenticationSession](#AuthenticationSession) is added, removed, or changed.
 */
export interface AuthenticationProviderAuthenticationSessionsChangeEvent {
    /**
     * The ids of the [AuthenticationSession](#AuthenticationSession)s that have been added.
     */
    readonly added: ReadonlyArray<string>;

    /**
     * The ids of the [AuthenticationSession](#AuthenticationSession)s that have been removed.
     */
    readonly removed: ReadonlyArray<string>;

    /**
     * The ids of the [AuthenticationSession](#AuthenticationSession)s that have been changed.
     */
    readonly changed: ReadonlyArray<string>;
}

/**
 * A provider for performing authentication to a service.
 */
export interface AuthenticationProvider {
    /**
     * An [event](#Event) which fires when the array of sessions has changed, or data
     * within a session has changed.
     */
    readonly onDidChangeSessions: Event<AuthenticationProviderAuthenticationSessionsChangeEvent>;

    /**
     * Returns an array of current sessions.
     */
    // eslint-disable-next-line vscode-dts-provider-naming
    getSessions(): Thenable<ReadonlyArray<AuthenticationSession>>;

    /**
     * Prompts a user to login.
     */
    // eslint-disable-next-line vscode-dts-provider-naming
    login(scopes: string[]): Thenable<AuthenticationSession>;

    /**
     * Removes the session corresponding to session id.
     * @param sessionId The session id to log out of
     */
    // eslint-disable-next-line vscode-dts-provider-naming
    logout(sessionId: string): Thenable<void>;
}

/**
 * Options for creating an [AuthenticationProvider](#AuthentcationProvider).
 */
export interface AuthenticationProviderOptions {
    /**
     * Whether it is possible to be signed into multiple accounts at once with this provider.
     * If not specified, will default to false.
     */
    readonly supportsMultipleAccounts?: boolean;
}

export namespace authentication {
    /**
     * Register an authentication provider.
     *
     * There can only be one provider per id and an error is being thrown when an id
     * has already been used by another provider. Ids are case-sensitive.
     *
     * @param id The unique identifier of the provider.
     * @param label The human-readable name of the provider.
     * @param provider The authentication provider provider.
     * @params options Additional options for the provider.
     * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
     */
    export function registerAuthenticationProvider(
        id: string,
        label: string,
        provider: AuthenticationProvider,
        options?: AuthenticationProviderOptions
    ): Disposable;

    /**
     * @deprecated - getSession should now trigger extension activation.
     * Fires with the provider id that was registered or unregistered.
     */
    export const onDidChangeAuthenticationProviders: Event<AuthenticationProvidersChangeEvent>;

    /**
     * An array of the information of authentication providers that are currently registered.
     */
    export const providers: ReadonlyArray<AuthenticationProviderInformation>;

    /**
     * Logout of a specific session.
     * @param providerId The id of the provider to use
     * @param sessionId The session id to remove
     * provider
     */
    export function logout(providerId: string, sessionId: string): Thenable<void>;
}

//#endregion
//#region debug

/**
 * A DebugProtocolVariableContainer is an opaque stand-in type for the intersection of the Scope and Variable types defined in the Debug Adapter Protocol.
 * See https://microsoft.github.io/debug-adapter-protocol/specification#Types_Scope and https://microsoft.github.io/debug-adapter-protocol/specification#Types_Variable.
 */
export interface DebugProtocolVariableContainer {
    // Properties: the intersection of DAP's Scope and Variable types.
}

/**
 * A DebugProtocolVariable is an opaque stand-in type for the Variable type defined in the Debug Adapter Protocol.
 * See https://microsoft.github.io/debug-adapter-protocol/specification#Types_Variable.
 */
export interface DebugProtocolVariable {
    // Properties: see details [here](https://microsoft.github.io/debug-adapter-protocol/specification#Base_Protocol_Variable).
}
//#endregion
//#region https://github.com/microsoft/vscode/issues/106744, Notebooks (misc)

export enum CellKind {
    Markdown = 1,
    Code = 2
}

export enum NotebookCellRunState {
    Running = 1,
    Idle = 2,
    Success = 3,
    Error = 4
}

export enum NotebookRunState {
    Running = 1,
    Idle = 2
}

export interface NotebookCellMetadata {
    /**
     * Controls whether a cell's editor is editable/readonly.
     */
    editable?: boolean;

    /**
     * Controls if the cell is executable.
     * This metadata is ignored for markdown cell.
     */
    runnable?: boolean;

    /**
     * Controls if the cell has a margin to support the breakpoint UI.
     * This metadata is ignored for markdown cell.
     */
    breakpointMargin?: boolean;

    /**
     * Whether the [execution order](#NotebookCellMetadata.executionOrder) indicator will be displayed.
     * Defaults to true.
     */
    hasExecutionOrder?: boolean;

    /**
     * The order in which this cell was executed.
     */
    executionOrder?: number;

    /**
     * A status message to be shown in the cell's status bar
     */
    statusMessage?: string;

    /**
     * The cell's current run state
     */
    runState?: NotebookCellRunState;

    /**
     * If the cell is running, the time at which the cell started running
     */
    runStartTime?: number;

    /**
     * The total duration of the cell's last run
     */
    lastRunDuration?: number;

    /**
     * Whether a code cell's editor is collapsed
     */
    inputCollapsed?: boolean;

    /**
     * Whether a code cell's outputs are collapsed
     */
    outputCollapsed?: boolean;

    /**
     * Additional attributes of a cell metadata.
     */
    custom?: { [key: string]: any };
}

// todo@API support ids https://github.com/jupyter/enhancement-proposals/blob/master/62-cell-id/cell-id.md
export interface NotebookCell {
    readonly index: number;
    readonly notebook: NotebookDocument;
    readonly uri: Uri;
    readonly cellKind: CellKind;
    readonly document: TextDocument;
    readonly language: string;
    readonly outputs: readonly NotebookCellOutput[];
    readonly metadata: NotebookCellMetadata;
    /** @deprecated use WorkspaceEdit.replaceCellOutput */
    // outputs: CellOutput[];
    // readonly outputs2: NotebookCellOutput[];
    /** @deprecated use WorkspaceEdit.replaceCellMetadata */
    // metadata: NotebookCellMetadata;
}

export interface NotebookDocumentMetadata {
    /**
     * Controls if users can add or delete cells
     * Defaults to true
     */
    editable?: boolean;

    /**
     * Controls whether the full notebook can be run at once.
     * Defaults to true
     */
    runnable?: boolean;

    /**
     * Default value for [cell editable metadata](#NotebookCellMetadata.editable).
     * Defaults to true.
     */
    cellEditable?: boolean;

    /**
     * Default value for [cell runnable metadata](#NotebookCellMetadata.runnable).
     * Defaults to true.
     */
    cellRunnable?: boolean;

    /**
     * Default value for [cell hasExecutionOrder metadata](#NotebookCellMetadata.hasExecutionOrder).
     * Defaults to true.
     */
    cellHasExecutionOrder?: boolean;

    displayOrder?: GlobPattern[];

    /**
     * Additional attributes of the document metadata.
     */
    custom?: { [key: string]: any };

    /**
     * The document's current run state
     */
    runState?: NotebookRunState;

    /**
     * Whether the document is trusted, default to true
     * When false, insecure outputs like HTML, JavaScript, SVG will not be rendered.
     */
    trusted?: boolean;

    /**
     * Languages the document supports
     */
    languages?: string[];
}

export interface NotebookDocumentContentOptions {
    /**
     * Controls if outputs change will trigger notebook document content change and if it will be used in the diff editor
     * Default to false. If the content provider doesn't persisit the outputs in the file document, this should be set to true.
     */
    transientOutputs: boolean;

    /**
     * Controls if a meetadata property change will trigger notebook document content change and if it will be used in the diff editor
     * Default to false. If the content provider doesn't persisit a metadata property in the file document, it should be set to true.
     */
    transientMetadata: { [K in keyof NotebookCellMetadata]?: boolean };
}

export interface NotebookDocument {
    readonly uri: Uri;
    readonly version: number;
    readonly fileName: string;
    readonly viewType: string;
    readonly isDirty: boolean;
    readonly isUntitled: boolean;
    readonly cells: ReadonlyArray<NotebookCell>;
    readonly contentOptions: NotebookDocumentContentOptions;
    // todo@API
    // make readonly
    // languages comes from the kernel
    languages: string[];
    readonly metadata: NotebookDocumentMetadata;
}

// todo@API maybe have a NotebookCellPosition sibling
// todo@API should be a class
export interface NotebookCellRange {
    readonly start: number;
    /**
     * exclusive
     */
    readonly end: number;
}

export enum NotebookEditorRevealType {
    /**
     * The range will be revealed with as little scrolling as possible.
     */
    Default = 0,
    /**
     * The range will always be revealed in the center of the viewport.
     */
    InCenter = 1,

    /**
     * If the range is outside the viewport, it will be revealed in the center of the viewport.
     * Otherwise, it will be revealed with as little scrolling as possible.
     */
    InCenterIfOutsideViewport = 2,

    /**
     * The range will always be revealed at the top of the viewport.
     */
    AtTop = 3
}

export interface NotebookEditor {
    /**
     * The document associated with this notebook editor.
     */
    readonly document: NotebookDocument;

    /**
     * The primary selected cell on this notebook editor.
     */
    // todo@API should not be undefined, rather a default
    readonly selection?: NotebookCell;

    // @rebornix
    // todo@API should replace selection
    // never empty!
    // primary/secondary selections
    // readonly selections: NotebookCellRange[];

    /**
     * The current visible ranges in the editor (vertically).
     */
    readonly visibleRanges: NotebookCellRange[];

    revealRange(range: NotebookCellRange, revealType?: NotebookEditorRevealType): void;

    /**
     * The column in which this editor shows.
     */
    // @jrieken
    // todo@API maybe never undefined because notebooks always show in the editor area (unlike text editors)
    // maybe for notebook diff editor
    readonly viewColumn?: ViewColumn;

    /**
     * Fired when the panel is disposed.
     */
    // @rebornix REMOVE/REplace NotebookCommunication
    // todo@API fishy? notebooks are public objects, there should be a "global" events for this
    readonly onDidDispose: Event<void>;
}

export interface NotebookDocumentMetadataChangeEvent {
    readonly document: NotebookDocument;
}

export interface NotebookCellsChangeData {
    readonly start: number;
    readonly deletedCount: number;
    readonly deletedItems: NotebookCell[];
    readonly items: NotebookCell[];
}

export interface NotebookCellsChangeEvent {
    /**
     * The affected document.
     */
    readonly document: NotebookDocument;
    readonly changes: ReadonlyArray<NotebookCellsChangeData>;
}

export interface NotebookCellOutputsChangeEvent {
    /**
     * The affected document.
     */
    readonly document: NotebookDocument;
    readonly cells: NotebookCell[];
}

export interface NotebookCellLanguageChangeEvent {
    /**
     * The affected document.
     */
    readonly document: NotebookDocument;
    readonly cell: NotebookCell;
    readonly language: string;
}

export interface NotebookCellMetadataChangeEvent {
    readonly document: NotebookDocument;
    readonly cell: NotebookCell;
}

export interface NotebookEditorSelectionChangeEvent {
    readonly notebookEditor: NotebookEditor;
    // @rebornix
    // todo@API show NotebookCellRange[] instead
    readonly selection?: NotebookCell;
}

export interface NotebookEditorVisibleRangesChangeEvent {
    readonly notebookEditor: NotebookEditor;
    readonly visibleRanges: ReadonlyArray<NotebookCellRange>;
}

// todo@API support ids https://github.com/jupyter/enhancement-proposals/blob/master/62-cell-id/cell-id.md
export interface NotebookCellData {
    readonly cellKind: CellKind;
    readonly source: string;
    readonly language: string;
    // todo@API maybe use a separate data type?
    readonly outputs: NotebookCellOutput[];
    readonly metadata: NotebookCellMetadata | undefined;
}

export interface NotebookData {
    readonly cells: NotebookCellData[];
    readonly languages: string[];
    readonly metadata: NotebookDocumentMetadata;
}

/**
 * Communication object passed to the {@link NotebookContentProvider} and
 * {@link NotebookOutputRenderer} to communicate with the webview.
 */
export interface NotebookCommunication {
    /**
     * ID of the editor this object communicates with. A single notebook
     * document can have multiple attached webviews and editors, when the
     * notebook is split for instance. The editor ID lets you differentiate
     * between them.
     */
    readonly editorId: string;

    /**
     * Fired when the output hosting webview posts a message.
     */
    readonly onDidReceiveMessage: Event<any>;
    /**
     * Post a message to the output hosting webview.
     *
     * Messages are only delivered if the editor is live.
     *
     * @param message Body of the message. This must be a string or other json serializable object.
     */
    postMessage(message: any): Thenable<boolean>;

    /**
     * Convert a uri for the local file system to one that can be used inside outputs webview.
     */
    asWebviewUri(localResource: Uri): Uri;

    // @rebornix
    // readonly onDidDispose: Event<void>;
}

// export function registerNotebookKernel(selector: string, kernel: NotebookKernel): Disposable;

export interface NotebookDocumentShowOptions {
    viewColumn?: ViewColumn;
    preserveFocus?: boolean;
    preview?: boolean;
    selection?: NotebookCellRange;
}

export namespace notebook {
    export function openNotebookDocument(uri: Uri, viewType?: string): Thenable<NotebookDocument>;
    export const onDidOpenNotebookDocument: Event<NotebookDocument>;
    export const onDidCloseNotebookDocument: Event<NotebookDocument>;

    // todo@API really needed?
    export const onDidSaveNotebookDocument: Event<NotebookDocument>;

    /**
     * All currently known notebook documents.
     */
    export const notebookDocuments: ReadonlyArray<NotebookDocument>;
    export const onDidChangeNotebookDocumentMetadata: Event<NotebookDocumentMetadataChangeEvent>;
    export const onDidChangeNotebookCells: Event<NotebookCellsChangeEvent>;
    export const onDidChangeCellOutputs: Event<NotebookCellOutputsChangeEvent>;
    export const onDidChangeCellLanguage: Event<NotebookCellLanguageChangeEvent>;
    export const onDidChangeCellMetadata: Event<NotebookCellMetadataChangeEvent>;
}

export namespace window {
    export const visibleNotebookEditors: NotebookEditor[];
    export const onDidChangeVisibleNotebookEditors: Event<NotebookEditor[]>;
    export const activeNotebookEditor: NotebookEditor | undefined;
    export const onDidChangeActiveNotebookEditor: Event<NotebookEditor | undefined>;
    export const onDidChangeNotebookEditorSelection: Event<NotebookEditorSelectionChangeEvent>;
    export const onDidChangeNotebookEditorVisibleRanges: Event<NotebookEditorVisibleRangesChangeEvent>;
    export function showNotebookDocument(
        document: NotebookDocument,
        options?: NotebookDocumentShowOptions
    ): Thenable<NotebookEditor>;
}

//#endregion

//#region https://github.com/microsoft/vscode/issues/106744, NotebookCellOutput

// code specific mime types
// application/x.notebook.error-traceback
// application/x.notebook.stream
export class NotebookCellOutputItem {
    // todo@API
    // add factory functions for common mime types
    // static textplain(value:string): NotebookCellOutputItem;
    // static errortrace(value:any): NotebookCellOutputItem;

    readonly mime: string;
    readonly value: unknown;
    readonly metadata?: Record<string, string | number | boolean | unknown>;

    constructor(mime: string, value: unknown, metadata?: Record<string, string | number | boolean | unknown>);
}

// @jrieken
//TODO@API add execution count to cell output?
export class NotebookCellOutput {
    readonly id: string;
    readonly outputs: NotebookCellOutputItem[];
    constructor(outputs: NotebookCellOutputItem[]);
}

//#endregion

//#region https://github.com/microsoft/vscode/issues/106744, NotebookEditorEdit

export interface WorkspaceEdit {
    replaceNotebookMetadata(uri: Uri, value: NotebookDocumentMetadata): void;

    // todo@API use NotebookCellRange
    replaceNotebookCells(
        uri: Uri,
        start: number,
        end: number,
        cells: NotebookCellData[],
        metadata?: WorkspaceEditEntryMetadata
    ): void;
    replaceNotebookCellMetadata(
        uri: Uri,
        index: number,
        cellMetadata: NotebookCellMetadata,
        metadata?: WorkspaceEditEntryMetadata
    ): void;

    replaceNotebookCellOutput(
        uri: Uri,
        index: number,
        outputs: NotebookCellOutput[],
        metadata?: WorkspaceEditEntryMetadata
    ): void;
    appendNotebookCellOutput(
        uri: Uri,
        index: number,
        outputs: NotebookCellOutput[],
        metadata?: WorkspaceEditEntryMetadata
    ): void;

    // TODO@api
    // https://jupyter-protocol.readthedocs.io/en/latest/messaging.html#update-display-data
    replaceNotebookCellOutputItems(
        uri: Uri,
        index: number,
        outputId: string,
        items: NotebookCellOutputItem[],
        metadata?: WorkspaceEditEntryMetadata
    ): void;
    appendNotebookCellOutputItems(
        uri: Uri,
        index: number,
        outputId: string,
        items: NotebookCellOutputItem[],
        metadata?: WorkspaceEditEntryMetadata
    ): void;
}

export interface NotebookEditorEdit {
    replaceMetadata(value: NotebookDocumentMetadata): void;
    replaceCells(start: number, end: number, cells: NotebookCellData[]): void;
    replaceCellOutput(index: number, outputs: NotebookCellOutput[]): void;
    replaceCellMetadata(index: number, metadata: NotebookCellMetadata): void;
}

export interface NotebookEditor {
    /**
     * Perform an edit on the notebook associated with this notebook editor.
     *
     * The given callback-function is invoked with an [edit-builder](#NotebookEditorEdit) which must
     * be used to make edits. Note that the edit-builder is only valid while the
     * callback executes.
     *
     * @param callback A function which can create edits using an [edit-builder](#NotebookEditorEdit).
     * @return A promise that resolves with a value indicating if the edits could be applied.
     */
    // @jrieken REMOVE maybe
    edit(callback: (editBuilder: NotebookEditorEdit) => void): Thenable<boolean>;
}

//#endregion

//#region https://github.com/microsoft/vscode/issues/106744, NotebookContentProvider

interface NotebookDocumentBackup {
    /**
     * Unique identifier for the backup.
     *
     * This id is passed back to your extension in `openNotebook` when opening a notebook editor from a backup.
     */
    readonly id: string;

    /**
     * Delete the current backup.
     *
     * This is called by VS Code when it is clear the current backup is no longer needed, such as when a new backup
     * is made or when the file is saved.
     */
    delete(): void;
}

interface NotebookDocumentBackupContext {
    readonly destination: Uri;
}

interface NotebookDocumentOpenContext {
    readonly backupId?: string;
}

export interface NotebookContentProvider {
    readonly options?: NotebookDocumentContentOptions;
    readonly onDidChangeNotebookContentOptions?: Event<NotebookDocumentContentOptions>;
    /**
     * Content providers should always use [file system providers](#FileSystemProvider) to
     * resolve the raw content for `uri` as the resouce is not necessarily a file on disk.
     */
    // eslint-disable-next-line vscode-dts-provider-naming
    openNotebook(uri: Uri, openContext: NotebookDocumentOpenContext): NotebookData | Thenable<NotebookData>;
    // eslint-disable-next-line vscode-dts-provider-naming
    // eslint-disable-next-line vscode-dts-cancellation
    resolveNotebook(document: NotebookDocument, webview: NotebookCommunication): Thenable<void>;
    // eslint-disable-next-line vscode-dts-provider-naming
    saveNotebook(document: NotebookDocument, cancellation: CancellationToken): Thenable<void>;
    // eslint-disable-next-line vscode-dts-provider-naming
    saveNotebookAs(targetResource: Uri, document: NotebookDocument, cancellation: CancellationToken): Thenable<void>;
    // eslint-disable-next-line vscode-dts-provider-naming
    backupNotebook(
        document: NotebookDocument,
        context: NotebookDocumentBackupContext,
        cancellation: CancellationToken
    ): Thenable<NotebookDocumentBackup>;

    // ???
    // provideKernels(document: NotebookDocument, token: CancellationToken): ProviderResult<T[]>;
}

export namespace notebook {
    // TODO@api use NotebookDocumentFilter instead of just notebookType:string?
    // TODO@API options duplicates the more powerful variant on NotebookContentProvider
    export function registerNotebookContentProvider(
        notebookType: string,
        provider: NotebookContentProvider,
        options?: NotebookDocumentContentOptions & {
            /**
             * Not ready for production or development use yet.
             */
            viewOptions?: {
                displayName: string;
                filenamePattern: NotebookFilenamePattern[];
                exclusive?: boolean;
            };
        }
    ): Disposable;
}

//#endregion

//#region https://github.com/microsoft/vscode/issues/106744, NotebookKernel

export interface NotebookKernel {
    readonly id?: string;
    label: string;
    description?: string;
    detail?: string;
    isPreferred?: boolean;
    preloads?: Uri[];
    // @roblourens
    // todo@API change to `executeCells(document: NotebookDocument, cells: NotebookCellRange[], context:{isWholeNotebooke: boolean}, token: CancelationToken): void;`
    // todo@API interrupt vs cancellation, https://github.com/microsoft/vscode/issues/106741
    // interrupt?():void;
    executeCell(document: NotebookDocument, cell: NotebookCell): void;
    cancelCellExecution(document: NotebookDocument, cell: NotebookCell): void;
    executeAllCells(document: NotebookDocument): void;
    cancelAllCellsExecution(document: NotebookDocument): void;
}

export type NotebookFilenamePattern = GlobPattern | { include: GlobPattern; exclude: GlobPattern };

// todo@API why not for NotebookContentProvider?
export interface NotebookDocumentFilter {
    viewType?: string | string[];
    filenamePattern?: NotebookFilenamePattern;
}

// todo@API very unclear, provider MUST not return alive object but only data object
// todo@API unclear how the flow goes
export interface NotebookKernelProvider<T extends NotebookKernel = NotebookKernel> {
    onDidChangeKernels?: Event<NotebookDocument | undefined>;
    provideKernels(document: NotebookDocument, token: CancellationToken): ProviderResult<T[]>;
    resolveKernel?(
        kernel: T,
        document: NotebookDocument,
        webview: NotebookCommunication,
        token: CancellationToken
    ): ProviderResult<void>;
}

export interface NotebookEditor {
    /**
     * Active kernel used in the editor
     */
    // todo@API unsure about that
    // kernel, kernel selection, kernel provider
    readonly kernel?: NotebookKernel;
}

export namespace notebook {
    export const onDidChangeActiveNotebookKernel: Event<{
        document: NotebookDocument;
        kernel: NotebookKernel | undefined;
    }>;

    export function registerNotebookKernelProvider(
        selector: NotebookDocumentFilter,
        provider: NotebookKernelProvider
    ): Disposable;
}

//#endregion

//#region https://github.com/microsoft/vscode/issues/106744, NotebookEditorDecorationType

export interface NotebookEditor {
    setDecorations(decorationType: NotebookEditorDecorationType, range: NotebookCellRange): void;
}

export interface NotebookEditorDecorationType {
    readonly key: string;
    dispose(): void;
}

//#endregion

//#region https://github.com/microsoft/vscode/issues/106744, NotebookCellStatusBarItem

/**
 * Represents the alignment of status bar items.
 */
export enum NotebookCellStatusBarAlignment {
    /**
     * Aligned to the left side.
     */
    Left = 1,

    /**
     * Aligned to the right side.
     */
    Right = 2
}

export interface NotebookCellStatusBarItem {
    readonly cell: NotebookCell;
    readonly alignment: NotebookCellStatusBarAlignment;
    readonly priority?: number;
    text: string;
    tooltip: string | undefined;
    command: string | Command | undefined;
    accessibilityInformation?: AccessibilityInformation;
    show(): void;
    hide(): void;
    dispose(): void;
}

export namespace notebook {
    /**
     * Creates a notebook cell status bar [item](#NotebookCellStatusBarItem).
     * It will be disposed automatically when the notebook document is closed or the cell is deleted.
     *
     * @param cell The cell on which this item should be shown.
     * @param alignment The alignment of the item.
     * @param priority The priority of the item. Higher values mean the item should be shown more to the left.
     * @return A new status bar item.
     */
    // @roblourens
    // todo@API this should be a provider, https://github.com/microsoft/vscode/issues/105809
    export function createCellStatusBarItem(
        cell: NotebookCell,
        alignment?: NotebookCellStatusBarAlignment,
        priority?: number
    ): NotebookCellStatusBarItem;
}

//#endregion

//#region https://github.com/microsoft/vscode/issues/106744, NotebookConcatTextDocument

export namespace notebook {
    /**
     * Create a document that is the concatenation of all  notebook cells. By default all code-cells are included
     * but a selector can be provided to narrow to down the set of cells.
     *
     * @param notebook
     * @param selector
     */
    // @jrieken REMOVE. p_never
    // todo@API really needed? we didn't find a user here
    export function createConcatTextDocument(
        notebook: NotebookDocument,
        selector?: DocumentSelector
    ): NotebookConcatTextDocument;
}

export class Position {

    /**
     * The zero-based line value.
     */
    readonly line: number;

    /**
     * The zero-based character value.
     */
    readonly character: number;

    /**
     * @param line A zero-based line value.
     * @param character A zero-based character value.
     */
    constructor(line: number, character: number);

    /**
     * Check if this position is before `other`.
     *
     * @param other A position.
     * @return `true` if position is on a smaller line
     * or on the same line on a smaller character.
     */
    isBefore(other: Position): boolean;

    /**
     * Check if this position is before or equal to `other`.
     *
     * @param other A position.
     * @return `true` if position is on a smaller line
     * or on the same line on a smaller or equal character.
     */
    isBeforeOrEqual(other: Position): boolean;

    /**
     * Check if this position is after `other`.
     *
     * @param other A position.
     * @return `true` if position is on a greater line
     * or on the same line on a greater character.
     */
    isAfter(other: Position): boolean;

    /**
     * Check if this position is after or equal to `other`.
     *
     * @param other A position.
     * @return `true` if position is on a greater line
     * or on the same line on a greater or equal character.
     */
    isAfterOrEqual(other: Position): boolean;

    /**
     * Check if this position is equal to `other`.
     *
     * @param other A position.
     * @return `true` if the line and character of the given position are equal to
     * the line and character of this position.
     */
    isEqual(other: Position): boolean;

    /**
     * Compare this to `other`.
     *
     * @param other A position.
     * @return A number smaller than zero if this position is before the given position,
     * a number greater than zero if this position is after the given position, or zero when
     * this and the given position are equal.
     */
    compareTo(other: Position): number;

    /**
     * Create a new position relative to this position.
     *
     * @param lineDelta Delta value for the line value, default is `0`.
     * @param characterDelta Delta value for the character value, default is `0`.
     * @return A position which line and character is the sum of the current line and
     * character and the corresponding deltas.
     */
    translate(lineDelta?: number, characterDelta?: number): Position;

    /**
     * Derived a new position relative to this position.
     *
     * @param change An object that describes a delta to this position.
     * @return A position that reflects the given delta. Will return `this` position if the change
     * is not changing anything.
     */
    translate(change: { lineDelta?: number; characterDelta?: number; }): Position;

    /**
     * Create a new position derived from this position.
     *
     * @param line Value that should be used as line value, default is the [existing value](#Position.line)
     * @param character Value that should be used as character value, default is the [existing value](#Position.character)
     * @return A position where line and character are replaced by the given values.
     */
    with(line?: number, character?: number): Position;

    /**
     * Derived a new position from this position.
     *
     * @param change An object that describes a change to this position.
     * @return A position that reflects the given change. Will return `this` position if the change
     * is not changing anything.
     */
    with(change: { line?: number; character?: number; }): Position;
}

export interface NotebookConcatTextDocument {
    uri: Uri;
    isClosed: boolean;
    dispose(): void;
    onDidChange: Event<void>;
    version: number;
    getText(): string;
    getText(range: Range): string;

    offsetAt(position: Position): number;
    positionAt(offset: number): Position;
    validateRange(range: Range): Range;
    validatePosition(position: Position): Position;

    locationAt(positionOrRange: Position | Range): Location;
    positionAt(location: Location): Position;
    contains(uri: Uri): boolean;
}

//#endregion
