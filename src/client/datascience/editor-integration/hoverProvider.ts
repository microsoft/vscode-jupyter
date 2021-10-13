// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable, named } from 'inversify';

import * as vscode from 'vscode';
import { IExtensionSyncActivationService } from '../../activation/types';
import { IVSCodeNotebook } from '../../common/application/types';
import { Cancellation } from '../../common/cancellation';
import { PYTHON } from '../../common/constants';
import { traceError } from '../../common/logger';
import { IFileSystem } from '../../common/platform/types';
import { IDisposableRegistry } from '../../common/types';

import { sleep } from '../../common/utils/async';
import { StopWatch } from '../../common/utils/stopWatch';
import { sendTelemetryEvent } from '../../telemetry';
import { Identifiers, Telemetry } from '../constants';
import { getInteractiveCellMetadata } from '../interactive-window/interactiveWindow';
import { IKernel, IKernelProvider } from '../jupyter/kernels/types';
import { InteractiveWindowView } from '../notebook/constants';
import { IInteractiveWindowProvider, IJupyterVariables } from '../types';
@injectable()
export class HoverProvider implements IExtensionSyncActivationService, vscode.HoverProvider {
    private runFiles = new Set<string>();
    private hoverProviderRegistration: vscode.Disposable | undefined;
    private stopWatch = new StopWatch();

    constructor(
        @inject(IJupyterVariables) @named(Identifiers.KERNEL_VARIABLES) private variableProvider: IJupyterVariables,
        @inject(IInteractiveWindowProvider) private interactiveProvider: IInteractiveWindowProvider,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IVSCodeNotebook) private readonly notebook: IVSCodeNotebook,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider
    ) {}
    public activate() {
        this.notebook.onDidChangeNotebookCellExecutionState(
            this.onDidChangeNotebookCellExecutionState,
            this,
            this.disposables
        );
        this.kernelProvider.onDidRestartKernel(() => this.runFiles.clear(), this, this.disposables);
    }
    public dispose() {
        if (this.hoverProviderRegistration) {
            this.hoverProviderRegistration.dispose();
        }
    }
    private async onDidChangeNotebookCellExecutionState(
        e: vscode.NotebookCellExecutionStateChangeEvent
    ): Promise<void> {
        try {
            if (e.cell.notebook.notebookType !== InteractiveWindowView) {
                return;
            }
            const size = this.runFiles.size;
            const metadata = getInteractiveCellMetadata(e.cell);
            if (metadata !== undefined) {
                this.runFiles.add(metadata.interactive.file.toLocaleLowerCase());
            }
            if (size !== this.runFiles.size) {
                await this.initializeHoverProvider();
            }
        } catch (exc) {
            // Don't let exceptions in a preExecute mess up normal operation
            traceError(exc);
        }
    }

    public async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        const timeoutHandler = sleep(300).then(() => undefined);
        this.stopWatch.reset();
        const result = await Promise.race([timeoutHandler, this.getVariableHover(document, position, token)]);
        sendTelemetryEvent(Telemetry.InteractiveFileTooltipsPerf, this.stopWatch.elapsedTime, {
            isResultNull: !!result
        });
        return result;
    }

    private async initializeHoverProvider() {
        if (!this.hoverProviderRegistration) {
            this.hoverProviderRegistration = vscode.languages.registerHoverProvider(PYTHON, this);
        }
    }

    private getVariableHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        // Make sure to fail as soon as the cancel token is signaled
        return Cancellation.race(async (t) => {
            const range = document.getWordRangeAtPosition(position);
            if (range) {
                const word = document.getText(range);
                if (word) {
                    // See if we have any matching notebooks
                    const notebooks = this.getMatchingKernels(document);
                    if (notebooks.length) {
                        // Just use the first one to reply if more than one.
                        const attributes = await Promise.race(
                            // Note, getVariableProperties is non null here because we are specifically
                            // injecting kernelVariables, which does define this interface method
                            notebooks.map((n) => this.variableProvider.getVariableProperties!(word, n, t))
                        );
                        const entries = Object.entries(attributes);
                        if (entries.length > 0) {
                            const asMarkdown =
                                entries.reduce((accum, entry) => accum + `${entry[0]}: ${entry[1]}\n`, '```\n') + '```';
                            const result = {
                                contents: [new vscode.MarkdownString(asMarkdown)]
                            };
                            return result;
                        }
                    }
                }
            }
            return;
        }, token);
    }

    private getMatchingKernels(document: vscode.TextDocument): IKernel[] {
        // First see if we have an interactive window who's owner is this document
        let notebookUris = this.interactiveProvider.windows
            .filter((w) => w.owner && this.fs.arePathsSame(w.owner, document.uri))
            .map((w) => w.notebookUri?.toString());
        if (!Array.isArray(notebookUris) || notebookUris.length == 0) {
            return [];
        }
        const kernels = new Set<IKernel>();
        this.notebook.notebookDocuments
            .filter((item) => notebookUris.includes(item.uri.toString()))
            .forEach((item) => {
                const kernel = this.kernelProvider.get(item);
                if (kernel) {
                    kernels.add(kernel);
                }
            });
        return Array.from(kernels);
    }
}
