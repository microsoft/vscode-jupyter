// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../../common/extensions';

import { injectable, unmanaged } from 'inversify';
import * as path from 'path';
import { WebviewView as vscodeWebviewView } from 'vscode';

import { IVSCodeNotebook, IWebviewViewProvider, IWorkspaceService } from '../../../common/application/types';
import { EXTENSION_ROOT_DIR, isTestExecution } from '../../../common/constants';
import { IConfigurationService, IDisposable, IDisposableRegistry, Resource } from '../../../common/types';
import { IInteractiveWindowMapping, InteractiveWindowMessages } from '../../interactive-common/interactiveWindowTypes';
import { CellState, ICodeCssGenerator, INotebook, IThemeFinder } from '../../types';
import { WebviewViewHost } from '../../webviews/webviewViewHost';
import { INotebookWatcher } from '../types';
import { SimpleMessageListener } from '../../interactive-common/simpleMessageListener';
import { traceError } from '../../../common/logger';
import { Identifiers } from '../../constants';
import { createCodeCell } from '../../../../datascience-ui/common/cellFactory';
import * as localize from '../../../common/utils/localize';
import { SharedMessages } from '../../messages';

const root = path.join(EXTENSION_ROOT_DIR, 'out', 'datascience-ui', 'viewers');

// This is the client side host for the scratch pad (shown in the jupyter tab)
@injectable()
export class ScratchPad extends WebviewViewHost<IInteractiveWindowMapping> implements IDisposable {
    private vscodeWebView: vscodeWebviewView | undefined;
    protected get owningResource(): Resource {
        return undefined;
    }
    constructor(
        @unmanaged() configuration: IConfigurationService,
        @unmanaged() cssGenerator: ICodeCssGenerator,
        @unmanaged() themeFinder: IThemeFinder,
        @unmanaged() workspaceService: IWorkspaceService,
        @unmanaged() provider: IWebviewViewProvider,
        @unmanaged() private readonly disposables: IDisposableRegistry,
        @unmanaged() private readonly notebookWatcher: INotebookWatcher,
        @unmanaged() private readonly vscNotebooks: IVSCodeNotebook
    ) {
        super(
            configuration,
            cssGenerator,
            themeFinder,
            workspaceService,
            (c, d) => new SimpleMessageListener(c, d),
            provider,
            root,
            [path.join(root, 'commons.initial.bundle.js'), path.join(root, 'scratchPad.js')]
        );

        // Sign up if the active variable view notebook is changed, restarted or updated
        this.notebookWatcher.onDidExecuteActiveNotebook(this.activeNotebookExecuted, this, this.disposables);
        this.notebookWatcher.onDidChangeActiveNotebook(this.activeNotebookChanged, this, this.disposables);
        this.notebookWatcher.onDidRestartActiveNotebook(this.activeNotebookRestarted, this, this.disposables);
    }

    // Used to identify this webview in telemetry, not shown to user so no localization
    // for webview views
    public get title(): string {
        return 'scratchPad';
    }

    public async load(codeWebview: vscodeWebviewView) {
        this.vscodeWebView = codeWebview;
        await super.loadWebview(process.cwd(), codeWebview).catch(traceError);

        // Send our first empty cell
        await this.postMessage(InteractiveWindowMessages.LoadAllCells, {
            cells: [
                {
                    id: '0',
                    file: Identifiers.EmptyFileName,
                    line: 0,
                    state: CellState.finished,
                    data: createCodeCell('')
                }
            ],
            isNotebookTrusted: true
        });

        // Set the title if there is an active notebook
        if (this.vscNotebooks.activeNotebookEditor && this.vscodeWebView) {
            this.vscodeWebView.title = localize.DataScience.scratchPadTitleFormat().format(
                path.basename(this.vscNotebooks.activeNotebookEditor.document.uri.fsPath)
            );
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected onMessage(message: string, payload: any) {
        switch (message) {
            case InteractiveWindowMessages.Started:
                // Send the first settings message
                this.onDataScienceSettingsChanged().ignoreErrors();

                // Send the loc strings (skip during testing as it takes up a lot of memory)
                const locStrings = isTestExecution() ? '{}' : localize.getCollectionJSON();
                this.postMessageInternal(SharedMessages.LocInit, locStrings).ignoreErrors();
                break;

            default:
                break;
        }

        super.onMessage(message, payload);
    }

    // Handle message helper function to specifically handle our message mapping type
    protected handleMessage<M extends IInteractiveWindowMapping, T extends keyof M>(
        _message: T,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payload: any,
        handler: (args: M[T]) => void
    ) {
        const args = payload as M[T];
        handler.bind(this)(args);
    }

    // The active variable view notebook has executed a new cell so update the execution count in the variable view
    private async activeNotebookExecuted(args: { executionCount: number }) {
        this.postMessage(InteractiveWindowMessages.UpdateVariableViewExecutionCount, {
            executionCount: args.executionCount
        }).ignoreErrors();
    }

    // The active variable new notebook has changed, so force a refresh on the view to pick up the new info
    private async activeNotebookChanged(arg: { notebook?: INotebook; executionCount?: number }) {
        if (arg.executionCount) {
            this.postMessage(InteractiveWindowMessages.UpdateVariableViewExecutionCount, {
                executionCount: arg.executionCount
            }).ignoreErrors();
        } else {
            this.postMessage(InteractiveWindowMessages.UpdateVariableViewExecutionCount, {
                executionCount: 0
            }).ignoreErrors();
        }

        this.postMessage(InteractiveWindowMessages.ForceVariableRefresh).ignoreErrors();
    }

    private async activeNotebookRestarted() {
        this.postMessage(InteractiveWindowMessages.RestartKernel).ignoreErrors();
    }
}
