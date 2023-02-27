// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ConfigurationChangeEvent,
    EventEmitter,
    extensions,
    Uri,
    WebviewPanel as vscodeWebviewPanel,
    WebviewView as vscodeWebviewView,
    WorkspaceConfiguration
} from 'vscode';
import { IWebview, IWorkspaceService } from '../common/application/types';
import { DefaultTheme, PythonExtension, Telemetry } from '../common/constants';
import { traceInfo } from '../logging';
import { Resource, IConfigurationService, IDisposable } from '../common/types';
import { Deferred, createDeferred } from '../common/utils/async';
import { testOnlyMethod } from '../common/utils/decorators';
import * as localize from '../common/utils/localize';
import { StopWatch } from '../common/utils/stopWatch';
import { InteractiveWindowMessages, LocalizedMessages, SharedMessages } from '../../messageTypes';
import { sendTelemetryEvent } from '../../telemetry';
import { IJupyterExtraSettings } from './types';
import { getOSType, OSType } from '../common/utils/platform';
import { noop } from '../common/utils/misc';

/* eslint-disable @typescript-eslint/no-explicit-any */

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

    protected get onDidDispose() {
        return this._onDidDisposeWebviewPanel.event;
    }

    protected _onDidDisposeWebviewPanel = new EventEmitter<void>();

    constructor(
        protected configService: IConfigurationService,
        protected workspaceService: IWorkspaceService,
        protected rootPath: Uri,
        protected scripts: Uri[]
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
            this._disposables.forEach((item) => item.dispose());
        }

        this.webviewInit = undefined;
        this._onDidDisposeWebviewPanel.fire();
    }

    // This function is used for testing webview by fetching HTML from the webview via a message
    // @ts-ignore Property will be accessed in test code via casting to ITestWebviewHost
    @testOnlyMethod()
    // @ts-ignore Property will be accessed in test code via casting to ITestWebviewHost
    private getHTMLById(id: string): Promise<string> {
        if (!this.activeHTMLRequest) {
            this.activeHTMLRequest = createDeferred<string>();
            this.postMessageInternal(InteractiveWindowMessages.GetHTMLByIdRequest, id).catch(noop);
        } else {
            throw new Error('getHTMLById request already in progress');
        }

        return this.activeHTMLRequest.promise;
    }

    // For testing add a callback listening to messages from the webview
    // tslint:disable-next-line:no-any
    @testOnlyMethod()
    // @ts-ignore Property will be accessed in test code via casting to ITestWebviewHost
    private addMessageListener(callback: (message: string, payload: any) => void) {
        this.onMessageListeners.push(callback);
    }

    // For testing remove a callback listening to messages from the webview
    // tslint:disable-next-line:no-any
    @testOnlyMethod()
    // @ts-ignore Property will be accessed in test code via casting to ITestWebviewHost
    private removeMessageListener(callback: (message: string, payload: any) => void) {
        const index = this.onMessageListeners.indexOf(callback);
        if (index >= 0) {
            this.onMessageListeners.splice(index, 1);
        }
    }

    protected abstract provideWebview(
        cwd: Uri,
        settings: IJupyterExtraSettings,
        workspaceFolder: Resource,
        vscodeWebview?: vscodeWebviewPanel | vscodeWebviewView
    ): Promise<IWebview>;

    // Post a message to our webview and update our new datascience settings
    protected onDataScienceSettingsChanged = async () => {
        // Stringify our settings to send over to the panel
        const dsSettings = JSON.stringify(await this.generateDataScienceExtraSettings());
        this.postMessageInternal(SharedMessages.UpdateSettings, dsSettings).catch(noop);
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

    protected async loadWebview(cwd: Uri, webView?: vscodeWebviewPanel | vscodeWebviewView) {
        // Make not disposed anymore
        this.disposed = false;

        // Setup our init promise for the web panel. We use this to make sure we're in sync with our
        // react control.
        this.webviewInit = this.webviewInit || createDeferred();

        traceInfo(`Loading webview. View is ${this.webview ? 'set' : 'notset'}`);

        // Create our web panel (it's the UI that shows up for the history)
        if (this.webview === undefined) {
            // Get our settings to pass along to the react control
            const settings = await this.generateDataScienceExtraSettings();

            traceInfo('Loading web view...');

            const workspaceFolder = this.workspaceService.getWorkspaceFolder(cwd)?.uri;

            this.webview = await this.provideWebview(cwd, settings, workspaceFolder, webView);

            // Track to see if our webview fails to load
            this._disposables.push(this.webview.loadFailed(this.onWebViewLoadFailed, this));

            traceInfo('Webview panel created.');
        }

        // Send the first settings message
        this.onDataScienceSettingsChanged().catch(noop);

        // Send the loc strings (skip during testing as it takes up a lot of memory)
        this.sendLocStrings().catch(noop);
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
                hasPythonExtension: pythonExt !== undefined,
                isWeb: getOSType() === OSType.Unknown
            }
        };
    }

    protected async sendLocStrings() {
        const locStrings: LocalizedMessages = {
            collapseSingle: localize.WebViews.collapseSingle,
            expandSingle: localize.WebViews.expandSingle,
            openExportFileYes: localize.DataScience.openExportFileYes,
            openExportFileNo: localize.DataScience.openExportFileNo,
            noRowsInDataViewer: localize.WebViews.noRowsInDataViewer,
            sliceIndexError: localize.WebViews.sliceIndexError,
            sliceMismatchedAxesError: localize.WebViews.sliceMismatchedAxesError,
            filterRowsTooltip: localize.WebViews.sliceMismatchedAxesError,
            fetchingDataViewer: localize.WebViews.fetchingDataViewer,
            dataViewerHideFilters: localize.WebViews.dataViewerHideFilters,
            dataViewerShowFilters: localize.WebViews.dataViewerShowFilters,
            refreshDataViewer: localize.WebViews.refreshDataViewer,
            clearFilters: localize.WebViews.refreshDataViewer,
            sliceSummaryTitle: localize.WebViews.sliceSummaryTitle,
            sliceData: localize.WebViews.sliceData,
            sliceSubmitButton: localize.WebViews.sliceSubmitButton,
            sliceDropdownAxisLabel: localize.WebViews.sliceDropdownAxisLabel,
            sliceDropdownIndexLabel: localize.WebViews.sliceDropdownIndexLabel,
            variableExplorerNameColumn: localize.WebViews.variableExplorerNameColumn,
            variableExplorerTypeColumn: localize.WebViews.variableExplorerTypeColumn,
            variableExplorerCountColumn: localize.WebViews.variableExplorerCountColumn,
            variableExplorerValueColumn: localize.WebViews.variableExplorerValueColumn,
            collapseVariableExplorerLabel: localize.WebViews.collapseVariableExplorerLabel,
            variableLoadingValue: localize.WebViews.variableLoadingValue,
            showDataExplorerTooltip: localize.WebViews.showDataExplorerTooltip,
            noRowsInVariableExplorer: localize.WebViews.noRowsInVariableExplorer,
            loadingRowsInVariableExplorer: localize.WebViews.loadingRowsInVariableExplorer,
            previousPlot: localize.WebViews.previousPlot,
            nextPlot: localize.WebViews.nextPlot,
            panPlot: localize.WebViews.panPlot,
            zoomInPlot: localize.WebViews.zoomInPlot,
            zoomOutPlot: localize.WebViews.zoomOutPlot,
            exportPlot: localize.WebViews.exportPlot,
            deletePlot: localize.WebViews.deletePlot,
            selectedImageListLabel: localize.WebViews.selectedImageListLabel,
            selectedImageLabel: localize.WebViews.selectedImageLabel
        };
        this.postMessageInternal(SharedMessages.LocInit, JSON.stringify(locStrings)).catch(noop);
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

    // When the webview has been rendered send telemetry and initial strings + settings
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected webViewRendered() {
        if (this.webviewInit && !this.webviewInit.resolved) {
            // Send telemetry for startup
            sendTelemetryEvent(Telemetry.WebviewStartup, { duration: this.startupStopwatch.elapsedTime });

            // Resolve our started promise. This means the webpanel is ready to go.
            this.webviewInit.resolve();

            traceInfo('Web view react rendered');
        }

        // On started, resend our init data.
        this.sendLocStrings().catch(noop);
        this.onDataScienceSettingsChanged().catch(noop);
    }

    // If our webview fails to load then just dispose ourselves
    private onWebViewLoadFailed = async () => {
        this.dispose();
    };

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
                this.postMessageInternal(SharedMessages.UpdateSettings, dsSettings).catch(noop);
            }
        }
    };
}
