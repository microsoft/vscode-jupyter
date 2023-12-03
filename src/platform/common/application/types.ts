// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    Breakpoint,
    BreakpointsChangeEvent,
    DebugAdapterTrackerFactory,
    DebugConfiguration,
    DebugConfigurationProvider,
    DebugConsole,
    DebugSession,
    DebugSessionCustomEvent,
    Disposable,
    Event,
    UIKind,
    Uri,
    ViewColumn,
    WebviewPanel as vscodeWebviewPanel,
    WebviewView as vscodeWebviewView,
    WorkspaceFolder
} from 'vscode';

import { IAsyncDisposable, Resource } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/unified-signatures */

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
