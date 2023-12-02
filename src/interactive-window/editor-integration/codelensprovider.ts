// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, optional } from 'inversify';
import * as vscode from 'vscode';

import { ICommandManager, IDebugService } from '../../platform/common/application/types';
import { ContextKey } from '../../platform/common/contextKey';
import { dispose } from '../../platform/common/utils/lifecycle';

import { IConfigurationService, IDisposable, IDisposableRegistry } from '../../platform/common/types';
import { noop } from '../../platform/common/utils/misc';
import { StopWatch } from '../../platform/common/utils/stopWatch';
import { IServiceContainer } from '../../platform/ioc/types';
import { sendTelemetryEvent } from '../../telemetry';
import { traceInfoIfCI, traceVerbose } from '../../platform/logging';
import {
    CodeLensCommands,
    EditorContexts,
    InteractiveInputScheme,
    NotebookCellScheme,
    Telemetry
} from '../../platform/common/constants';
import { IDataScienceCodeLensProvider, ICodeWatcher } from './types';
import * as urlPath from '../../platform/vscode-path/resources';
import { IDebugLocationTracker } from '../../notebooks/debugger/debuggingTypes';

/**
 * Implementation of the VS code CodeLensProvider that provides code lenses for the Interactive Window.
 * Uses a CodeWatcher to get the code lenses.
 *
 */
@injectable()
export class DataScienceCodeLensProvider implements IDataScienceCodeLensProvider, IDisposable {
    private totalExecutionTimeInMs: number = 0;
    private totalGetCodeLensCalls: number = 0;
    private activeCodeWatchers: ICodeWatcher[] = [];
    private didChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();

    constructor(
        @inject(IServiceContainer) private serviceContainer: IServiceContainer,
        @inject(IDebugLocationTracker) @optional() private debugLocationTracker: IDebugLocationTracker | undefined,
        @inject(IConfigurationService) private configuration: IConfigurationService,
        @inject(ICommandManager) private commandManager: ICommandManager,
        @inject(IDisposableRegistry) disposableRegistry: IDisposableRegistry,
        @inject(IDebugService) private debugService: IDebugService
    ) {
        disposableRegistry.push(this);
        disposableRegistry.push(
            vscode.workspace.onDidGrantWorkspaceTrust(() => {
                this.activeCodeWatchers = dispose(this.activeCodeWatchers);
                this.didChangeCodeLenses.fire();
            })
        );
        disposableRegistry.push(this.debugService.onDidChangeActiveDebugSession(this.onChangeDebugSession.bind(this)));
        disposableRegistry.push(vscode.workspace.onDidCloseTextDocument(this.onDidCloseTextDocument.bind(this)));
        if (this.debugLocationTracker) {
            disposableRegistry.push(this.debugLocationTracker.updated(this.onDebugLocationUpdated.bind(this)));
        }
    }

    public dispose() {
        // On shutdown send how long on average we spent parsing code lens
        if (this.totalGetCodeLensCalls > 0) {
            sendTelemetryEvent(Telemetry.CodeLensAverageAcquisitionTime, {
                duration: this.totalExecutionTimeInMs / this.totalGetCodeLensCalls
            });
        }
        dispose(this.activeCodeWatchers);
    }

    public get onDidChangeCodeLenses(): vscode.Event<void> {
        return this.didChangeCodeLenses.event;
    }

    // CodeLensProvider interface
    // Some implementation based on DonJayamanne's jupyter extension work
    public provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.CodeLens[] {
        if ([NotebookCellScheme, InteractiveInputScheme].includes(document.uri.scheme)) {
            return [];
        }
        // Get the list of code lens for this document.
        return this.getCodeLensTimed(document);
    }

    // IDataScienceCodeLensProvider interface
    public getCodeWatcher(document: vscode.TextDocument): ICodeWatcher | undefined {
        return this.matchWatcher(document.uri);
    }

    private onDebugLocationUpdated() {
        this.didChangeCodeLenses.fire();
    }

    private onChangeDebugSession(_e: vscode.DebugSession | undefined) {
        this.didChangeCodeLenses.fire();
    }

    private onDidCloseTextDocument(e: vscode.TextDocument) {
        const index = this.activeCodeWatchers.findIndex((item) => item.uri && item.uri.toString() === e.uri.toString());
        if (index >= 0) {
            const codewatcher = this.activeCodeWatchers.splice(index, 1);
            codewatcher[0].dispose();
        }
    }

    private getCodeLensTimed(document: vscode.TextDocument): vscode.CodeLens[] {
        const stopWatch = new StopWatch();
        const codeLenses = this.getCodeLens(document);
        this.totalExecutionTimeInMs += stopWatch.elapsedTime;
        this.totalGetCodeLensCalls += 1;

        // Update the hasCodeCells context at the same time we are asked for codelens as VS code will
        // ask whenever a change occurs. Do this regardless of if we have code lens turned on or not as
        // shift+enter relies on this code context.
        const editorContext = new ContextKey(EditorContexts.HasCodeCells, this.commandManager);
        editorContext.set(codeLenses && codeLenses.length > 0).catch(noop);

        // Don't provide any code lenses if we have not enabled data science
        const settings = this.configuration.getSettings(document.uri);
        if (!settings.enableCellCodeLens) {
            return [];
        }

        return this.adjustDebuggingLenses(document, codeLenses);
    }

    // Adjust what code lenses are visible or not given debug mode and debug context location
    private adjustDebuggingLenses(document: vscode.TextDocument, lenses: vscode.CodeLens[]): vscode.CodeLens[] {
        const debugCellList = CodeLensCommands.DebuggerCommands;

        if (this.debugLocationTracker && this.debugService.activeDebugSession) {
            const debugLocation = this.debugLocationTracker.getLocation(this.debugService.activeDebugSession);

            // Debug locations only work on local paths, so check against fsPath here.
            let uri: vscode.Uri | undefined;
            try {
                // When dealing with Jupyter debugger protocol, the paths are stringified Uris.
                uri = debugLocation ? vscode.Uri.parse(debugLocation.fileName) : undefined;
            } catch {
                //
            }
            if (
                debugLocation &&
                (urlPath.isEqual(vscode.Uri.file(debugLocation.fileName), document.uri, true) ||
                    (uri && urlPath.isEqual(uri, document.uri, true)))
            ) {
                // We are in the given debug file, so only return the code lens that contains the given line
                const activeLenses = lenses.filter((lens) => {
                    // -1 for difference between file system one based and debugger zero based
                    const pos = new vscode.Position(debugLocation.lineNumber - 1, debugLocation.column - 1);
                    return lens.range.contains(pos);
                });

                return activeLenses.filter((lens) => {
                    if (lens.command) {
                        return debugCellList.includes(lens.command.command);
                    }
                    return false;
                });
            } else {
                traceInfoIfCI(
                    `Detected debugging context because activeDebugSession is name:"${this.debugService.activeDebugSession.name}", type: "${this.debugService.activeDebugSession.type}", ` +
                        `but fell through with debugLocation: ${JSON.stringify(
                            debugLocation
                        )}, and document.uri: ${document.uri.toString()}`
                );
            }
        } else {
            return lenses.filter((lens) => {
                if (lens.command) {
                    return !debugCellList.includes(lens.command.command);
                }
                return false;
            });
        }

        // Fall through case to return nothing
        return [];
    }

    private getCodeLens(document: vscode.TextDocument): vscode.CodeLens[] {
        // See if we already have a watcher for this file and version
        const codeWatcher: ICodeWatcher | undefined = this.matchWatcher(document.uri);
        if (codeWatcher) {
            return codeWatcher.getCodeLenses();
        }

        traceVerbose(`Creating a new watcher for document ${document.uri}`);
        const newCodeWatcher = this.createNewCodeWatcher(document);
        return newCodeWatcher.getCodeLenses();
    }

    private matchWatcher(uri: vscode.Uri): ICodeWatcher | undefined {
        const index = this.activeCodeWatchers.findIndex((item) => item.uri && item.uri.toString() == uri.toString());
        if (index >= 0) {
            return this.activeCodeWatchers[index];
        }

        // Create a new watcher for this file if we can find a matching document
        const possibleDocuments = vscode.workspace.textDocuments.filter((d) => d.uri.toString() === uri.toString());
        if (possibleDocuments && possibleDocuments.length > 0) {
            traceVerbose(`creating new code watcher with matching document ${uri}`);
            return this.createNewCodeWatcher(possibleDocuments[0]);
        }

        return undefined;
    }

    private createNewCodeWatcher(document: vscode.TextDocument): ICodeWatcher {
        const newCodeWatcher = this.serviceContainer.get<ICodeWatcher>(ICodeWatcher);
        newCodeWatcher.setDocument(document);
        newCodeWatcher.codeLensUpdated(this.onWatcherUpdated.bind(this));
        this.activeCodeWatchers.push(newCodeWatcher);
        return newCodeWatcher;
    }

    private onWatcherUpdated(): void {
        this.didChangeCodeLenses.fire();
    }
}
