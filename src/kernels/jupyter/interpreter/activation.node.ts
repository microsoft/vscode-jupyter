// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { NotebookDocument, workspace } from 'vscode';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { Telemetry } from '../../../platform/common/constants';
import { IDisposableRegistry } from '../../../platform/common/types';
import { getNotebookFormat, isJupyterNotebook } from '../../../platform/common/utils';
import { noop } from '../../../platform/common/utils/misc';
import { sendTelemetryEvent } from '../../../telemetry';
import { JupyterInterpreterService } from './jupyterInterpreterService.node';
import { IRawNotebookSupportedService } from '../../raw/types';

/**
 * Starts up a bunch of objects when running in a node environment.
 */
@injectable()
export class Activation implements IExtensionSyncActivationService {
    private notebookOpened = false;
    constructor(
        @inject(JupyterInterpreterService) private readonly jupyterInterpreterService: JupyterInterpreterService,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IRawNotebookSupportedService) private readonly rawSupported: IRawNotebookSupportedService,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker
    ) {}
    public activate() {
        this.disposables.push(workspace.onDidOpenNotebookDocument(this.onDidOpenNotebookEditor, this));
        this.disposables.push(this.jupyterInterpreterService.onDidChangeInterpreter(this.onDidChangeInterpreter, this));
    }

    private onDidOpenNotebookEditor(e: NotebookDocument) {
        if (!isJupyterNotebook(e)) {
            return;
        }
        this.notebookOpened = true;
        sendTelemetryEvent(Telemetry.OpenNotebookAll, getNotebookFormat(e));

        if (!this.rawSupported.isSupported && this.extensionChecker.isPythonExtensionInstalled) {
            // Warm up our selected interpreter for the extension
            this.jupyterInterpreterService.setInitialInterpreter().catch(noop);
        }
    }

    private onDidChangeInterpreter() {
        if (this.notebookOpened && !this.rawSupported.isSupported && this.extensionChecker.isPythonExtensionInstalled) {
            // Warm up our selected interpreter for the extension
            this.jupyterInterpreterService.setInitialInterpreter().catch(noop);
        }
    }
}
