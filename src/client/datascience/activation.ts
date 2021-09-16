// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { IExtensionSingleActivationService } from '../activation/types';
import { IPythonExtensionChecker } from '../api/types';
import '../common/extensions';
import { IPythonDaemonExecutionService, IPythonExecutionFactory } from '../common/process/types';
import { IDisposableRegistry } from '../common/types';
import { debounceAsync, swallowExceptions } from '../common/utils/decorators';
import { sendTelemetryEvent } from '../telemetry';
import { JupyterDaemonModule, Telemetry } from './constants';
import { ActiveEditorContextService } from './commands/activeEditorContext';
import { JupyterInterpreterService } from './jupyter/interpreter/jupyterInterpreterService';
import { KernelDaemonPreWarmer } from './kernel-launcher/kernelDaemonPreWarmer';
import { INotebookCreationTracker, IRawNotebookSupportedService } from './types';
import { IVSCodeNotebook } from '../common/application/types';
import { NotebookDocument } from 'vscode';
import { isJupyterNotebook } from './notebook/helpers/helpers';

@injectable()
export class Activation implements IExtensionSingleActivationService {
    private notebookOpened = false;
    constructor(
        @inject(IVSCodeNotebook) private readonly vscNotebook: IVSCodeNotebook,
        @inject(JupyterInterpreterService) private readonly jupyterInterpreterService: JupyterInterpreterService,
        @inject(IPythonExecutionFactory) private readonly factory: IPythonExecutionFactory,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(ActiveEditorContextService) private readonly contextService: ActiveEditorContextService,
        @inject(KernelDaemonPreWarmer) private readonly daemonPoolPrewarmer: KernelDaemonPreWarmer,
        @inject(IRawNotebookSupportedService) private readonly rawSupported: IRawNotebookSupportedService,
        @inject(INotebookCreationTracker)
        private readonly tracker: INotebookCreationTracker,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker
    ) {}
    public async activate(): Promise<void> {
        this.disposables.push(this.vscNotebook.onDidOpenNotebookDocument(this.onDidOpenNotebookEditor, this));
        this.disposables.push(this.jupyterInterpreterService.onDidChangeInterpreter(this.onDidChangeInterpreter, this));
        this.contextService.activate().ignoreErrors();
        this.daemonPoolPrewarmer.activate(undefined).ignoreErrors();
        this.tracker.startTracking();
    }

    private onDidOpenNotebookEditor(e: NotebookDocument) {
        if (!isJupyterNotebook(e)) {
            return;
        }
        this.notebookOpened = true;
        this.PreWarmDaemonPool().ignoreErrors();
        sendTelemetryEvent(Telemetry.OpenNotebookAll);

        if (!this.rawSupported.isSupported && this.extensionChecker.isPythonExtensionInstalled) {
            // Warm up our selected interpreter for the extension
            this.jupyterInterpreterService.setInitialInterpreter().ignoreErrors();
        }
    }

    private onDidChangeInterpreter() {
        if (this.notebookOpened) {
            // Warm up our selected interpreter for the extension
            this.jupyterInterpreterService.setInitialInterpreter().ignoreErrors();
            this.PreWarmDaemonPool().ignoreErrors();
        }
    }

    @debounceAsync(500)
    @swallowExceptions('Failed to pre-warm daemon pool')
    private async PreWarmDaemonPool() {
        if (!this.extensionChecker.isPythonExtensionActive) {
            // Skip prewarm if no python extension
            return;
        }
        const interpreter = await this.jupyterInterpreterService.getSelectedInterpreter();
        if (!interpreter) {
            return;
        }
        await this.factory.createDaemon<IPythonDaemonExecutionService>({
            daemonModule: JupyterDaemonModule,
            pythonPath: interpreter.path
        });
    }
}
