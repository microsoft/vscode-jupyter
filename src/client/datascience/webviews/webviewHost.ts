// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import '../../common/extensions';

import { injectable, unmanaged } from 'inversify';
import {
    ConfigurationChangeEvent,
    extensions,
    Uri,
    WebviewPanel as vscodeWebviewPanel,
    WebviewView as vscodeWebviewView,
    WorkspaceConfiguration
} from 'vscode';

import { IWebview, IWorkspaceService } from '../../common/application/types';
import { isTestExecution } from '../../common/constants';
import { traceInfo } from '../../common/logger';
import { IConfigurationService, IDisposable, Resource } from '../../common/types';
import { createDeferred, Deferred } from '../../common/utils/async';
import * as localize from '../../common/utils/localize';
import { StopWatch } from '../../common/utils/stopWatch';
import { captureTelemetry, sendTelemetryEvent } from '../../telemetry';
import { DefaultTheme, PythonExtension, Telemetry } from '../constants';
import { InteractiveWindowMessages } from '../interactive-common/interactiveWindowTypes';
import { CssMessages, IGetCssRequest, IGetMonacoThemeRequest, SharedMessages } from '../messages';
import { ICodeCssGenerator, IJupyterExtraSettings, IThemeFinder } from '../types';

@injectable() // For some reason this is necessary to get the class hierarchy to work.
export abstract class WebviewHost<IMapping> implements IDisposable {
    protected abstract get owningResource(): Resource;

    protected abstract get title(): string;
    protected webview?: IWebview;

    protected disposed = false;

    protected themeIsDarkPromise: Deferred<boolean> | undefined = createDeferred<boolean>();

    protected webviewInit: Deferred<void> | undefined = createDeferred<void>();

    protected readonly _disposables: IDisposable[] = [];
    private startupStopwatch = new StopWatch();

    // For testing, holds the current request for webview HTML
    private activeHTMLRequest?: Deferred<string>;

    // For testing, broadcast messages to the following listeners
    // tslint:disable-next-line:no-any
    private onMessageListeners: ((message: string, payload: any) => void)[] = [];

    constructor(
        @unmanaged() protected configService: IConfigurationService,
        @unmanaged() private cssGenerator: ICodeCssGenerator,
        @unmanaged() protected themeFinder: IThemeFinder,
        @unmanaged() protected workspaceService: IWorkspaceService,
        @unmanaged() protected rootPath: string,
        @unmanaged() protected scripts: string[],
        @unmanaged() protected readonly useCustomEditorApi: boolean
    ) {
        // Listen for settings changes from vscode.
        this._disposables.push(this.workspaceService.onDidChangeConfiguration(this.onPossibleSettingsChange, this));

        // Listen for settings changes
        this._disposables.push(
            this.configService.getSettings(undefined).onDidChange(this.onDataScienceSettingsChanged.bind(this))
        );
    }

    public dispose() {
        if (!this.disposed) {
            this.disposed = true;
            this.themeIsDarkPromise = undefined;
            this._disposables.forEach((item) => item.dispose());
        }

        this.webviewInit = undefined;
    }

    public setTheme(isDark: boolean) {
        if (this.themeIsDarkPromise && !this.themeIsDarkPromise.resolved) {
            this.themeIsDarkPromise.resolve(isDark);
        } else {
            this.themeIsDarkPromise = createDeferred<boolean>();
            this.themeIsDarkPromise.resolve(isDark);
        }
    }

    // This function is used for testing webview by fetching HTML from the webview via a message
    public getHTMLById(id: string): Promise<string> {
        // Test only
        if (!isTestExecution()) {
            throw new Error('getHTMLById to be run only in test code');
        }

        if (!this.activeHTMLRequest) {
            this.activeHTMLRequest = createDeferred<string>();
            this.postMessageInternal(InteractiveWindowMessages.GetHTMLByIdRequest, id).ignoreErrors();
        } else {
            throw new Error('getHTMLById request already in progress');
        }

        return this.activeHTMLRequest.promise;
    }

    // For testing add a callback listening to messages from the webview
    // tslint:disable-next-line:no-any
    public addMessageListener(callback: (message: string, payload: any) => void) {
        // Test only
        if (!isTestExecution()) {
            throw new Error('addMessageListener to be run only in test code');
        }

        this.onMessageListeners.push(callback);
    }

    // For testing remove a callback listening to messages from the webview
    // tslint:disable-next-line:no-any
    public removeMessageListener(callback: (message: string, payload: any) => void) {
        // Test only
        if (!isTestExecution()) {
            throw new Error('removeMessageListener to be run only in test code');
        }
        const index = this.onMessageListeners.indexOf(callback);
        if (index >= 0) {
            this.onMessageListeners.splice(index, 1);
        }
    }

    protected abstract provideWebview(
        cwd: string,
        settings: IJupyterExtraSettings,
        workspaceFolder: Resource,
        vscodeWebview?: vscodeWebviewPanel | vscodeWebviewView
    ): Promise<IWebview>;

    // Post a message to our webview and update our new datascience settings
    protected onDataScienceSettingsChanged = async () => {
        // Stringify our settings to send over to the panel
        const dsSettings = JSON.stringify(await this.generateDataScienceExtraSettings());
        this.postMessageInternal(SharedMessages.UpdateSettings, dsSettings).ignoreErrors();
    };

    protected asWebviewUri(localResource: Uri) {
        if (!this.webview) {
            throw new Error('asWebViewUri called too early');
        }
        return this.webview?.asWebviewUri(localResource);
    }

    protected postMessage<M extends IMapping, T extends keyof M>(type: T, payload?: M[T]): Promise<void> {
        // Then send it the message
        return this.postMessageInternal(type.toString(), payload);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected onMessage(message: string, payload: any) {
        switch (message) {
            case SharedMessages.Started:
                this.webViewRendered();
                break;

            case CssMessages.GetCssRequest:
                this.handleCssRequest(payload as IGetCssRequest).ignoreErrors();
                break;

            case CssMessages.GetMonacoThemeRequest:
                this.handleMonacoThemeRequest(payload as IGetMonacoThemeRequest).ignoreErrors();
                break;

            case InteractiveWindowMessages.GetHTMLByIdResponse:
                // Webview has returned HTML, resolve the request and clear it
                if (this.activeHTMLRequest) {
                    this.activeHTMLRequest.resolve(payload);
                    this.activeHTMLRequest = undefined;
                }
                break;

            default:
                break;
        }

        // Broadcast to any onMessage listeners
        this.onMessageListeners.forEach((listener) => {
            listener(message, payload);
        });
    }

    protected async loadWebview(cwd: string, webView?: vscodeWebviewPanel | vscodeWebviewView) {
        // Make not disposed anymore
        this.disposed = false;

        // Setup our init promise for the web panel. We use this to make sure we're in sync with our
        // react control.
        this.webviewInit = this.webviewInit || createDeferred();

        // Setup a promise that will wait until the webview passes back
        // a message telling us what them is in use
        this.themeIsDarkPromise = this.themeIsDarkPromise ? this.themeIsDarkPromise : createDeferred<boolean>();

        traceInfo(`Loading webview. View is ${this.webview ? 'set' : 'notset'}`);

        // Create our web panel (it's the UI that shows up for the history)
        if (this.webview === undefined) {
            // Get our settings to pass along to the react control
            const settings = await this.generateDataScienceExtraSettings();

            traceInfo('Loading web view...');

            const workspaceFolder = this.workspaceService.getWorkspaceFolder(Uri.file(cwd))?.uri;

            this.webview = await this.provideWebview(cwd, settings, workspaceFolder, webView);

            // Track to seee if our webview fails to load
            this._disposables.push(this.webview.loadFailed(this.onWebViewLoadFailed, this));

            traceInfo('Webview panel created.');
        }

        // Send the first settings message
        this.onDataScienceSettingsChanged().ignoreErrors();

        // Send the loc strings (skip during testing as it takes up a lot of memory)
        this.sendLocStrings().ignoreErrors();
    }

    protected async generateDataScienceExtraSettings(): Promise<IJupyterExtraSettings> {
        const resource = this.owningResource;
        const editor = this.workspaceService.getConfiguration('editor');
        const workbench = this.workspaceService.getConfiguration('workbench');
        const theme = !workbench ? DefaultTheme : workbench.get<string>('colorTheme', DefaultTheme);
        const pythonExt = extensions.getExtension(PythonExtension);
        const sendableSettings = JSON.parse(JSON.stringify(this.configService.getSettings(resource)));

        return {
            ...sendableSettings,
            extraSettings: {
                editor: {
                    cursor: this.getValue(editor, 'cursorStyle', 'line'),
                    cursorBlink: this.getValue(editor, 'cursorBlinking', 'blink'),
                    autoClosingBrackets: this.getValue(editor, 'autoClosingBrackets', 'languageDefined'),
                    autoClosingQuotes: this.getValue(editor, 'autoClosingQuotes', 'languageDefined'),
                    autoSurround: this.getValue(editor, 'autoSurround', 'languageDefined'),
                    autoIndent: this.getValue(editor, 'autoIndent', false),
                    fontLigatures: this.getValue(editor, 'fontLigatures', false),
                    scrollBeyondLastLine: this.getValue(editor, 'scrollBeyondLastLine', true),
                    // VS Code puts a value for this, but it's 10 (the explorer bar size) not 14 the editor size for vert
                    verticalScrollbarSize: this.getValue(editor, 'scrollbar.verticalScrollbarSize', 14),
                    horizontalScrollbarSize: this.getValue(editor, 'scrollbar.horizontalScrollbarSize', 10),
                    fontSize: this.getValue(editor, 'fontSize', 14),
                    fontFamily: this.getValue(editor, 'fontFamily', "Consolas, 'Courier New', monospace")
                },
                theme,
                useCustomEditorApi: this.useCustomEditorApi,
                hasPythonExtension: pythonExt !== undefined
            },
            intellisenseOptions: {
                quickSuggestions: {
                    other: this.getValue(editor, 'quickSuggestions.other', true),
                    comments: this.getValue(editor, 'quickSuggestions.comments', false),
                    strings: this.getValue(editor, 'quickSuggestions.strings', false)
                },
                acceptSuggestionOnEnter: this.getValue(editor, 'acceptSuggestionOnEnter', 'on'),
                quickSuggestionsDelay: this.getValue(editor, 'quickSuggestionsDelay', 10),
                suggestOnTriggerCharacters: this.getValue(editor, 'suggestOnTriggerCharacters', true),
                tabCompletion: this.getValue(editor, 'tabCompletion', 'on'),
                suggestLocalityBonus: this.getValue(editor, 'suggest.localityBonus', true),
                suggestSelection: this.getValue(editor, 'suggestSelection', 'recentlyUsed'),
                wordBasedSuggestions: this.getValue(editor, 'wordBasedSuggestions', true),
                parameterHintsEnabled: this.getValue(editor, 'parameterHints.enabled', true)
            }
        };
    }

    protected async sendLocStrings() {
        const locStrings = isTestExecution() ? '{}' : localize.getCollectionJSON();
        this.postMessageInternal(SharedMessages.LocInit, locStrings).ignoreErrors();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected async postMessageInternal(type: string, payload?: any): Promise<void> {
        if (this.webviewInit) {
            // Make sure the webpanel is up before we send it anything.
            await this.webviewInit.promise;

            // Then send it the message
            this.webview?.postMessage({ type: type.toString(), payload });
        }
    }

    protected isDark(): Promise<boolean> {
        return this.themeIsDarkPromise ? this.themeIsDarkPromise.promise : Promise.resolve(false);
    }

    // When the webview has been rendered send telemetry and initial strings + settings
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected webViewRendered() {
        if (this.webviewInit && !this.webviewInit.resolved) {
            // Send telemetry for startup
            sendTelemetryEvent(Telemetry.WebviewStartup, this.startupStopwatch.elapsedTime, { type: this.title });

            // Resolve our started promise. This means the webpanel is ready to go.
            this.webviewInit.resolve();

            traceInfo('Web view react rendered');
        }

        // On started, resend our init data.
        this.sendLocStrings().ignoreErrors();
        this.onDataScienceSettingsChanged().ignoreErrors();
    }

    // If our webview fails to load then just dispose ourselves
    private onWebViewLoadFailed = async () => {
        this.dispose();
    };

    @captureTelemetry(Telemetry.WebviewStyleUpdate)
    private async handleCssRequest(request: IGetCssRequest): Promise<void> {
        const settings = await this.generateDataScienceExtraSettings();
        const requestIsDark = settings.ignoreVscodeTheme ? false : request?.isDark;
        this.setTheme(requestIsDark);
        const isDark = settings.ignoreVscodeTheme
            ? false
            : await this.themeFinder.isThemeDark(settings.extraSettings.theme);
        const resource = this.owningResource;
        const css = await this.cssGenerator.generateThemeCss(resource, requestIsDark, settings.extraSettings.theme);
        return this.postMessageInternal(CssMessages.GetCssResponse, {
            css,
            theme: settings.extraSettings.theme,
            knownDark: isDark
        });
    }

    @captureTelemetry(Telemetry.WebviewMonacoStyleUpdate)
    private async handleMonacoThemeRequest(request: IGetMonacoThemeRequest): Promise<void> {
        const settings = await this.generateDataScienceExtraSettings();
        const isDark = settings.ignoreVscodeTheme ? false : request?.isDark;
        this.setTheme(isDark);
        const resource = this.owningResource;
        const monacoTheme = await this.cssGenerator.generateMonacoTheme(resource, isDark, settings.extraSettings.theme);
        return this.postMessageInternal(CssMessages.GetMonacoThemeResponse, { theme: monacoTheme });
    }

    private getValue<T>(workspaceConfig: WorkspaceConfiguration, section: string, defaultValue: T): T {
        if (workspaceConfig) {
            return workspaceConfig.get(section, defaultValue);
        }
        return defaultValue;
    }

    // Post a message to our webpanel and update our new datascience settings
    private onPossibleSettingsChange = async (event: ConfigurationChangeEvent) => {
        if (
            event.affectsConfiguration('workbench.colorTheme') ||
            event.affectsConfiguration('editor.fontSize') ||
            event.affectsConfiguration('editor.fontFamily') ||
            event.affectsConfiguration('editor.cursorStyle') ||
            event.affectsConfiguration('editor.cursorBlinking') ||
            event.affectsConfiguration('editor.autoClosingBrackets') ||
            event.affectsConfiguration('editor.autoClosingQuotes') ||
            event.affectsConfiguration('editor.autoSurround') ||
            event.affectsConfiguration('editor.autoIndent') ||
            event.affectsConfiguration('editor.scrollBeyondLastLine') ||
            event.affectsConfiguration('editor.fontLigatures') ||
            event.affectsConfiguration('editor.scrollbar.verticalScrollbarSize') ||
            event.affectsConfiguration('editor.scrollbar.horizontalScrollbarSize') ||
            event.affectsConfiguration('files.autoSave') ||
            event.affectsConfiguration('files.autoSaveDelay') ||
            event.affectsConfiguration('jupyter.widgetScriptSources')
        ) {
            // See if the theme changed
            const newSettings = await this.generateDataScienceExtraSettings();
            if (newSettings) {
                const dsSettings = JSON.stringify(newSettings);
                this.postMessageInternal(SharedMessages.UpdateSettings, dsSettings).ignoreErrors();
            }
        }
    };
}
