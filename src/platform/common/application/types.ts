// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    Breakpoint,
    BreakpointsChangeEvent,
    CancellationToken,
    DebugAdapterTrackerFactory,
    DebugConfiguration,
    DebugConfigurationProvider,
    DebugConsole,
    DebugSession,
    DebugSessionCustomEvent,
    Disposable,
    Event,
    InputBox,
    InputBoxOptions,
    MessageItem,
    MessageOptions,
    OpenDialogOptions,
    OutputChannel,
    Progress,
    ProgressOptions,
    QuickPick,
    QuickPickItem,
    QuickPickOptions,
    SaveDialogOptions,
    StatusBarAlignment,
    StatusBarItem,
    TextEditor,
    TextEditorEdit,
    TreeView,
    TreeViewOptions,
    UIKind,
    Uri,
    ViewColumn,
    WebviewPanel as vscodeWebviewPanel,
    WebviewView as vscodeWebviewView,
    WindowState,
    WorkspaceFolder,
    WorkspaceFolderPickOptions,
    ColorTheme
} from 'vscode';

import { IAsyncDisposable, Resource } from '../types';
import { ICommandNameArgumentTypeMapping } from '../../../commands';

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/unified-signatures */

export const IApplicationShell = Symbol('IApplicationShell');
export interface IApplicationShell {
    readonly activeColorTheme: ColorTheme;
    /**
     * An [event](#Event) which fires when the focus state of the current window
     * changes. The value of the event represents whether the window is focused.
     */
    readonly onDidChangeWindowState: Event<WindowState>;

    showInformationMessage(message: string, ...items: string[]): Thenable<string | undefined>;

    /**
     * Show an information message to users. Optionally provide an array of items which will be presented as
     * clickable buttons.
     *
     * @param message The message to show.
     * @param options Configures the behaviour of the message.
     * @param items A set of items that will be rendered as actions in the message.
     * @return A thenable that resolves to the selected item or `undefined` when being dismissed.
     */
    showInformationMessage(message: string, options: MessageOptions, ...items: string[]): Thenable<string | undefined>;

    /**
     * Show an information message.
     *
     * @see [showInformationMessage](#window.showInformationMessage)
     *
     * @param message The message to show.
     * @param items A set of items that will be rendered as actions in the message.
     * @return A thenable that resolves to the selected item or `undefined` when being dismissed.
     */
    showInformationMessage<T extends MessageItem>(message: string, ...items: T[]): Thenable<T | undefined>;

    /**
     * Show an information message.
     *
     * @see [showInformationMessage](#window.showInformationMessage)
     *
     * @param message The message to show.
     * @param options Configures the behaviour of the message.
     * @param items A set of items that will be rendered as actions in the message.
     * @return A thenable that resolves to the selected item or `undefined` when being dismissed.
     */
    showInformationMessage<T extends MessageItem>(
        message: string,
        options: MessageOptions,
        ...items: T[]
    ): Thenable<T | undefined>;

    /**
     * Show a warning message.
     *
     * @see [showInformationMessage](#window.showInformationMessage)
     *
     * @param message The message to show.
     * @param items A set of items that will be rendered as actions in the message.
     * @return A thenable that resolves to the selected item or `undefined` when being dismissed.
     */
    showWarningMessage(message: string, ...items: string[]): Thenable<string | undefined>;

    /**
     * Show a warning message.
     *
     * @see [showInformationMessage](#window.showInformationMessage)
     *
     * @param message The message to show.
     * @param options Configures the behaviour of the message.
     * @param items A set of items that will be rendered as actions in the message.
     * @return A thenable that resolves to the selected item or `undefined` when being dismissed.
     */
    showWarningMessage(message: string, options: MessageOptions, ...items: string[]): Thenable<string | undefined>;

    /**
     * Show a warning message.
     *
     * @see [showInformationMessage](#window.showInformationMessage)
     *
     * @param message The message to show.
     * @param items A set of items that will be rendered as actions in the message.
     * @return A thenable that resolves to the selected item or `undefined` when being dismissed.
     */
    showWarningMessage<T extends MessageItem>(message: string, ...items: T[]): Thenable<T | undefined>;

    /**
     * Show a warning message.
     *
     * @see [showInformationMessage](#window.showInformationMessage)
     *
     * @param message The message to show.
     * @param options Configures the behaviour of the message.
     * @param items A set of items that will be rendered as actions in the message.
     * @return A thenable that resolves to the selected item or `undefined` when being dismissed.
     */
    showWarningMessage<T extends MessageItem>(
        message: string,
        options: MessageOptions,
        ...items: T[]
    ): Thenable<T | undefined>;

    /**
     * Show an error message.
     *
     * @see [showInformationMessage](#window.showInformationMessage)
     *
     * @param message The message to show.
     * @param items A set of items that will be rendered as actions in the message.
     * @return A thenable that resolves to the selected item or `undefined` when being dismissed.
     */
    showErrorMessage(message: string, ...items: string[]): Thenable<string | undefined>;

    /**
     * Show an error message.
     *
     * @see [showInformationMessage](#window.showInformationMessage)
     *
     * @param message The message to show.
     * @param options Configures the behaviour of the message.
     * @param items A set of items that will be rendered as actions in the message.
     * @return A thenable that resolves to the selected item or `undefined` when being dismissed.
     */
    showErrorMessage(message: string, options: MessageOptions, ...items: string[]): Thenable<string | undefined>;

    /**
     * Show an error message.
     *
     * @see [showInformationMessage](#window.showInformationMessage)
     *
     * @param message The message to show.
     * @param items A set of items that will be rendered as actions in the message.
     * @return A thenable that resolves to the selected item or `undefined` when being dismissed.
     */
    showErrorMessage<T extends MessageItem>(message: string, ...items: T[]): Thenable<T | undefined>;

    /**
     * Show an error message.
     *
     * @see [showInformationMessage](#window.showInformationMessage)
     *
     * @param message The message to show.
     * @param options Configures the behaviour of the message.
     * @param items A set of items that will be rendered as actions in the message.
     * @return A thenable that resolves to the selected item or `undefined` when being dismissed.
     */
    showErrorMessage<T extends MessageItem>(
        message: string,
        options: MessageOptions,
        ...items: T[]
    ): Thenable<T | undefined>;

    /**
     * Shows a selection list.
     *
     * @param items An array of strings, or a promise that resolves to an array of strings.
     * @param options Configures the behavior of the selection list.
     * @param token A token that can be used to signal cancellation.
     * @return A promise that resolves to the selection or `undefined`.
     */
    showQuickPick(
        items: string[] | Thenable<string[]>,
        options?: QuickPickOptions,
        token?: CancellationToken
    ): Thenable<string | undefined>;

    /**
     * Shows a selection list.
     *
     * @param items An array of items, or a promise that resolves to an array of items.
     * @param options Configures the behavior of the selection list.
     * @param token A token that can be used to signal cancellation.
     * @return A promise that resolves to the selected item or `undefined`.
     */
    showQuickPick<T extends QuickPickItem>(
        items: T[] | Thenable<T[]>,
        options?: QuickPickOptions,
        token?: CancellationToken
    ): Thenable<T | undefined>;

    /**
     * Shows a file open dialog to the user which allows to select a file
     * for opening-purposes.
     *
     * @param options Options that control the dialog.
     * @returns A promise that resolves to the selected resources or `undefined`.
     */
    showOpenDialog(options: OpenDialogOptions): Thenable<Uri[] | undefined>;

    /**
     * Shows a file save dialog to the user which allows to select a file
     * for saving-purposes.
     *
     * @param options Options that control the dialog.
     * @returns A promise that resolves to the selected resource or `undefined`.
     */
    showSaveDialog(options: SaveDialogOptions): Thenable<Uri | undefined>;

    /**
     * Opens an input box to ask the user for input.
     *
     * The returned value will be `undefined` if the input box was canceled (e.g. pressing ESC). Otherwise the
     * returned value will be the string typed by the user or an empty string if the user did not type
     * anything but dismissed the input box with OK.
     *
     * @param options Configures the behavior of the input box.
     * @param token A token that can be used to signal cancellation.
     * @return A promise that resolves to a string the user provided or to `undefined` in case of dismissal.
     */
    showInputBox(options?: InputBoxOptions, token?: CancellationToken): Thenable<string | undefined>;

    /**
     * Creates a [QuickPick](#QuickPick) to let the user pick an item from a list
     * of items of type T.
     *
     * Note that in many cases the more convenient [window.showQuickPick](#window.showQuickPick)
     * is easier to use. [window.createQuickPick](#window.createQuickPick) should be used
     * when [window.showQuickPick](#window.showQuickPick) does not offer the required flexibility.
     *
     * @return A new [QuickPick](#QuickPick).
     */
    createQuickPick<T extends QuickPickItem>(): QuickPick<T>;

    /**
     * Creates a [InputBox](#InputBox) to let the user enter some text input.
     *
     * Note that in many cases the more convenient [window.showInputBox](#window.showInputBox)
     * is easier to use. [window.createInputBox](#window.createInputBox) should be used
     * when [window.showInputBox](#window.showInputBox) does not offer the required flexibility.
     *
     * @return A new [InputBox](#InputBox).
     */
    createInputBox(): InputBox;
    /**
     * Opens URL in a default browser.
     *
     * @param url Url to open.
     */
    openUrl(url: string): void;

    /**
     * Set a message to the status bar. This is a short hand for the more powerful
     * status bar [items](#window.createStatusBarItem).
     *
     * @param text The message to show, supports icon substitution as in status bar [items](#StatusBarItem.text).
     * @param hideAfterTimeout Timeout in milliseconds after which the message will be disposed.
     * @return A disposable which hides the status bar message.
     */
    setStatusBarMessage(text: string, hideAfterTimeout: number): Disposable;

    /**
     * Set a message to the status bar. This is a short hand for the more powerful
     * status bar [items](#window.createStatusBarItem).
     *
     * @param text The message to show, supports icon substitution as in status bar [items](#StatusBarItem.text).
     * @param hideWhenDone Thenable on which completion (resolve or reject) the message will be disposed.
     * @return A disposable which hides the status bar message.
     */
    setStatusBarMessage(text: string, hideWhenDone: Thenable<any>): Disposable;

    /**
     * Set a message to the status bar. This is a short hand for the more powerful
     * status bar [items](#window.createStatusBarItem).
     *
     * *Note* that status bar messages stack and that they must be disposed when no
     * longer used.
     *
     * @param text The message to show, supports icon substitution as in status bar [items](#StatusBarItem.text).
     * @return A disposable which hides the status bar message.
     */
    setStatusBarMessage(text: string): Disposable;

    /**
     * Creates a status bar [item](#StatusBarItem).
     *
     * @param alignment The alignment of the item.
     * @param priority The priority of the item. Higher values mean the item should be shown more to the left.
     * @return A new status bar item.
     */
    createStatusBarItem(alignment?: StatusBarAlignment, priority?: number): StatusBarItem;
    /**
     * Shows a selection list of [workspace folders](#workspace.workspaceFolders) to pick from.
     * Returns `undefined` if no folder is open.
     *
     * @param options Configures the behavior of the workspace folder list.
     * @return A promise that resolves to the workspace folder or `undefined`.
     */
    showWorkspaceFolderPick(options?: WorkspaceFolderPickOptions): Thenable<WorkspaceFolder | undefined>;

    /**
     * Show progress in the editor. Progress is shown while running the given callback
     * and while the promise it returned isn't resolved nor rejected. The location at which
     * progress should show (and other details) is defined via the passed [`ProgressOptions`](#ProgressOptions).
     *
     * @param task A callback returning a promise. Progress state can be reported with
     * the provided [progress](#Progress)-object.
     *
     * To report discrete progress, use `increment` to indicate how much work has been completed. Each call with
     * a `increment` value will be summed up and reflected as overall progress until 100% is reached (a value of
     * e.g. `10` accounts for `10%` of work done).
     * Note that currently only `ProgressLocation.Notification` is capable of showing discrete progress.
     *
     * To monitor if the operation has been cancelled by the user, use the provided [`CancellationToken`](#CancellationToken).
     * Note that currently only `ProgressLocation.Notification` is supporting to show a cancel button to cancel the
     * long running operation.
     *
     * @return The thenable the task-callback returned.
     */
    withProgress<R>(
        options: ProgressOptions,
        task: (progress: Progress<{ message?: string; increment?: number }>, token: CancellationToken) => Thenable<R>
    ): Thenable<R>;

    /**
     * Show progress in the status bar with a custom icon instead of the default spinner.
     * Progress is shown while running the given callback and while the promise it returned isn't resolved nor rejected.
     * At the moment, progress can only be displayed in the status bar when using this method. If you want to
     * display it elsewhere, use `withProgress`.
     *
     * @param icon A valid Octicon.
     *
     * @param task A callback returning a promise. Progress state can be reported with
     * the provided [progress](#Progress)-object.
     *
     * To report discrete progress, use `increment` to indicate how much work has been completed. Each call with
     * a `increment` value will be summed up and reflected as overall progress until 100% is reached (a value of
     * e.g. `10` accounts for `10%` of work done).
     * Note that currently only `ProgressLocation.Notification` is capable of showing discrete progress.
     *
     * To monitor if the operation has been cancelled by the user, use the provided [`CancellationToken`](#CancellationToken).
     * Note that currently only `ProgressLocation.Notification` is supporting to show a cancel button to cancel the
     * long running operation.
     *
     * @return The thenable the task-callback returned.
     */
    withProgressCustomIcon<R>(
        icon: string,
        task: (progress: Progress<{ message?: string; increment?: number }>, token: CancellationToken) => Thenable<R>
    ): Thenable<R>;

    /**
     * Create a [TreeView](#TreeView) for the view contributed using the extension point `views`.
     * @param viewId Id of the view contributed using the extension point `views`.
     * @param options Options for creating the [TreeView](#TreeView)
     * @returns a [TreeView](#TreeView).
     */
    createTreeView<T>(viewId: string, options: TreeViewOptions<T>): TreeView<T>;

    /**
     * Creates a new [output channel](#OutputChannel) with the given name.
     *
     * @param name Human-readable string which will be used to represent the channel in the UI.
     */
    createOutputChannel(name: string): OutputChannel;
}

export const ICommandManager = Symbol('ICommandManager');

export interface ICommandManager {
    /**
     * Registers a command that can be invoked via a keyboard shortcut,
     * a menu item, an action, or directly.
     *
     * Registering a command with an existing command identifier twice
     * will cause an error.
     *
     * @param command A unique identifier for the command.
     * @param callback A command handler function.
     * @param thisArg The `this` context used when invoking the handler function.
     * @return Disposable which unregisters this command on disposal.
     */
    registerCommand<E extends keyof ICommandNameArgumentTypeMapping, U extends ICommandNameArgumentTypeMapping[E]>(
        command: E,
        callback: (...args: U) => any,
        thisArg?: any
    ): Disposable;

    /**
     * Registers a text editor command that can be invoked via a keyboard shortcut,
     * a menu item, an action, or directly.
     *
     * Text editor commands are different from ordinary [commands](#commands.registerCommand) as
     * they only execute when there is an active editor when the command is called. Also, the
     * command handler of an editor command has access to the active editor and to an
     * [edit](#TextEditorEdit)-builder.
     *
     * @param command A unique identifier for the command.
     * @param callback A command handler function with access to an [editor](#TextEditor) and an [edit](#TextEditorEdit).
     * @param thisArg The `this` context used when invoking the handler function.
     * @return Disposable which unregisters this command on disposal.
     */
    registerTextEditorCommand(
        command: string,
        callback: (textEditor: TextEditor, edit: TextEditorEdit, ...args: any[]) => void,
        thisArg?: any
    ): Disposable;

    /**
     * Executes the command denoted by the given command identifier.
     *
     * * *Note 1:* When executing an editor command not all types are allowed to
     * be passed as arguments. Allowed are the primitive types `string`, `boolean`,
     * `number`, `undefined`, and `null`, as well as [`Position`](#Position), [`Range`](#Range), [`Uri`](#Uri) and [`Location`](#Location).
     * * *Note 2:* There are no restrictions when executing commands that have been contributed
     * by extensions.
     *
     * @param command Identifier of the command to execute.
     * @param rest Parameters passed to the command function.
     * @return A thenable that resolves to the returned value of the given command. `undefined` when
     * the command handler function doesn't return anything.
     */
    executeCommand<T, E extends keyof ICommandNameArgumentTypeMapping, U extends ICommandNameArgumentTypeMapping[E]>(
        command: E,
        ...rest: U
    ): Thenable<T>;

    /**
     * Retrieve the list of all available commands. Commands starting an underscore are
     * treated as internal commands.
     *
     * @param filterInternal Set `true` to not see internal commands (starting with an underscore)
     * @return Thenable that resolves to a list of command ids.
     */
    getCommands(filterInternal?: boolean): Thenable<string[]>;
}

export const IWorkspaceService = Symbol('IWorkspaceService');

export interface IWorkspaceService {
    /**
     * Computes where the working directory of a file is
     * @param resource
     */
    computeWorkingDirectory(resource: Resource): Promise<string>;
}

export const IDebugService = Symbol('IDebugManager');

export interface IDebugService {
    /**
     * The currently active [debug session](#DebugSession) or `undefined`. The active debug session is the one
     * represented by the debug action floating window or the one currently shown in the drop down menu of the debug action floating window.
     * If no debug session is active, the value is `undefined`.
     */
    readonly activeDebugSession: DebugSession | undefined;

    /**
     * The currently active [debug console](#DebugConsole).
     */
    readonly activeDebugConsole: DebugConsole;

    /**
     * List of breakpoints.
     */
    readonly breakpoints: readonly Breakpoint[];

    /**
     * An [event](#Event) which fires when the [active debug session](#debug.activeDebugSession)
     * has changed. *Note* that the event also fires when the active debug session changes
     * to `undefined`.
     */
    readonly onDidChangeActiveDebugSession: Event<DebugSession | undefined>;

    /**
     * An [event](#Event) which fires when a new [debug session](#DebugSession) has been started.
     */
    readonly onDidStartDebugSession: Event<DebugSession>;

    /**
     * An [event](#Event) which fires when a custom DAP event is received from the [debug session](#DebugSession).
     */
    readonly onDidReceiveDebugSessionCustomEvent: Event<DebugSessionCustomEvent>;

    /**
     * An [event](#Event) which fires when a [debug session](#DebugSession) has terminated.
     */
    readonly onDidTerminateDebugSession: Event<DebugSession>;

    /**
     * An [event](#Event) that is emitted when the set of breakpoints is added, removed, or changed.
     */
    readonly onDidChangeBreakpoints: Event<BreakpointsChangeEvent>;

    /**
     * Register a [debug configuration provider](#DebugConfigurationProvider) for a specific debug type.
     * More than one provider can be registered for the same type.
     *
     * @param type The debug type for which the provider is registered.
     * @param provider The [debug configuration provider](#DebugConfigurationProvider) to register.
     * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
     */
    registerDebugConfigurationProvider(debugType: string, provider: DebugConfigurationProvider): Disposable;

    /**
     * Register a debug adapter tracker factory for the given debug type.
     *
     * @param debugType The debug type for which the factory is registered or '*' for matching all debug types.
     * @param factory The [debug adapter tracker factory](#DebugAdapterTrackerFactory) to register.
     * @return A [disposable](#Disposable) that unregisters this factory when being disposed.
     */
    registerDebugAdapterTrackerFactory(debugType: string, factory: DebugAdapterTrackerFactory): Disposable;

    /**
     * Start debugging by using either a named launch or named compound configuration,
     * or by directly passing a [DebugConfiguration](#DebugConfiguration).
     * The named configurations are looked up in '.vscode/launch.json' found in the given folder.
     * Before debugging starts, all unsaved files are saved and the launch configurations are brought up-to-date.
     * Folder specific variables used in the configuration (e.g. '${workspaceFolder}') are resolved against the given folder.
     * @param folder The [workspace folder](#WorkspaceFolder) for looking up named configurations and resolving variables or `undefined` for a non-folder setup.
     * @param nameOrConfiguration Either the name of a debug or compound configuration or a [DebugConfiguration](#DebugConfiguration) object.
     * @return A thenable that resolves when debugging could be successfully started.
     */
    startDebugging(
        folder: WorkspaceFolder | undefined,
        nameOrConfiguration: string | DebugConfiguration,
        parentSession?: DebugSession
    ): Thenable<boolean>;

    /**
     * Add breakpoints.
     * @param breakpoints The breakpoints to add.
     */
    addBreakpoints(breakpoints: Breakpoint[]): void;

    /**
     * Remove breakpoints.
     * @param breakpoints The breakpoints to remove.
     */
    removeBreakpoints(breakpoints: Breakpoint[]): void;
}

export const IApplicationEnvironment = Symbol('IApplicationEnvironment');
export interface IApplicationEnvironment {
    /**
     * The application name of the editor, like 'VS Code'.
     *
     * @readonly
     */
    readonly appName: string;

    /**
     * The extension name.
     *
     * @readonly
     */
    readonly extensionName: string;
    /**
     * The extension name.
     *
     * @readonly
     */
    readonly extensionVersion: string;

    /**
     * The application root folder from which the editor is running.
     *
     * @readonly
     */
    readonly appRoot: string;

    /**
     * Represents the preferred user-language, like `de-CH`, `fr`, or `en-US`.
     *
     * @readonly
     */
    readonly language: string;

    /**
     * A unique identifier for the computer.
     *
     * @readonly
     */
    readonly machineId: string;

    /**
     * A unique identifier for the current session.
     * Changes each time the editor is started.
     *
     * @readonly
     */
    readonly sessionId: string;
    /**
     * Contents of `package.json` as a JSON object.
     *
     * @type {any}
     * @memberof IApplicationEnvironment
     */
    readonly packageJson: any;
    /**
     * Gets the full path to the user settings file. (may or may not exist).
     *
     * @type {string}
     * @memberof IApplicationShell
     */
    readonly userSettingsFile: Uri | undefined;
    /**
     * Gets the full path to the user custom keybindings file. (may or may not exist).
     *
     * @type {string}
     * @memberof IApplicationShell
     */
    readonly userCustomKeybindingsFile: Uri | undefined;
    /**
     * The detected default shell for the extension host, this is overridden by the
     * `terminal.integrated.shell` setting for the extension host's platform.
     *
     * @type {string}
     * @memberof IApplicationShell
     */
    readonly shell: string;
    /**
     * Gets the vscode channel (whether 'insiders' or 'stable').
     */
    readonly channel: Channel;
    /**
     * The version of the editor.
     */
    readonly vscodeVersion: string;
    /**
     * The custom uri scheme the editor registers to in the operating system.
     */
    readonly uriScheme: string;
    readonly uiKind: UIKind;
}

export interface IWebviewMessageListener {
    /**
     * Listens to webview messages
     * @param message: the message being sent
     * @param payload: extra data that came with the message
     */
    onMessage(message: string, payload: any): void;
}

export const IWebviewPanelMessageListener = Symbol('IWebviewPanelMessageListener');
export interface IWebviewPanelMessageListener extends IWebviewMessageListener, IAsyncDisposable {
    /**
     * Listens to web panel state changes
     */
    onChangeViewState(panel: IWebviewPanel): void;
}

export const IWebviewViewMessageListener = Symbol('IWebviewViewMessageListener');
export interface IWebviewViewMessageListener extends IWebviewMessageListener, IAsyncDisposable {}

export type WebviewMessage = {
    /**
     * Message type
     */
    type: string;

    /**
     * Payload
     */
    payload?: any;
};

// Wraps a VS Code webview
export const IWebview = Symbol('IWebview');
export interface IWebview {
    /**
     * Event is fired when the load for a web panel fails
     */
    readonly loadFailed: Event<void>;
    /**
     * Sends a message to the hosted html page
     */
    postMessage(message: WebviewMessage): void;
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
    asWebviewUri(localResource: Uri): Uri;
}

// Wraps the VS Code webview view
export const IWebviewView = Symbol('IWebviewView');
export interface IWebviewView extends IWebview {
    readonly onDidChangeVisibility: Event<void>;
    readonly visible: boolean;
}

export interface IWebviewOptions {
    rootPath: Uri;
    cwd: Uri;
    scripts: Uri[];
    /**
     * Additional paths apart from cwd and rootPath, that webview would allow loading resources/files from.
     * E.g. required for webview to serve images from worksapces when nb is in a nested folder.
     */
    additionalPaths?: Uri[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    settings?: any;
    // Instead of creating a webview we may be passed on already created by VS Code
    webviewHost?: vscodeWebviewView | vscodeWebviewPanel;
}

export interface IWebviewViewOptions extends IWebviewOptions {
    listener: IWebviewViewMessageListener;
}

// Wraps the VS Code webview panel
export const IWebviewPanel = Symbol('IWebviewPanel');
export interface IWebviewPanel extends IWebview {
    /**
     * Editor position of the panel. This property is only set if the webview is in
     * one of the editor view columns.
     */
    viewColumn: ViewColumn | undefined;
    setTitle(val: string): void;
    /**
     * Makes the webpanel show up.
     * @return A Promise that can be waited on
     */
    show(preserveFocus: boolean): Promise<void>;

    /**
     * Indicates if this web panel is visible or not.
     */
    isVisible(): boolean;

    /**
     * Attempts to close the panel if it's visible
     */
    close(): void;
    /**
     * Indicates if the webview has the focus or not.
     */
    isActive(): boolean;
}

export interface IWebviewPanelOptions extends IWebviewOptions {
    viewColumn: ViewColumn;
    listener: IWebviewPanelMessageListener;
    title: string;
}

// Wraps the VS Code api for creating a web panel
export const IWebviewPanelProvider = Symbol('IWebviewPanelProvider');
export interface IWebviewPanelProvider {
    create(options: IWebviewPanelOptions): Promise<IWebviewPanel>;
}

export interface IWebviewViewOptions extends IWebviewOptions {
    listener: IWebviewViewMessageListener;
}

export const IWebviewViewProvider = Symbol('IWebviewViewProvider');
export interface IWebviewViewProvider {
    create(options: IWebviewViewOptions): Promise<IWebviewView>;
}
export type Channel = 'stable' | 'insiders';

export const IEncryptedStorage = Symbol('IEncryptedStorage');
export interface IEncryptedStorage {
    store(service: string, key: string, value: string | undefined): Promise<void>;
    retrieve(service: string, key: string): Promise<string | undefined>;
}
