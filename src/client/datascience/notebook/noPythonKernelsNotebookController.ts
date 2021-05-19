// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Disposable, NotebookCell, NotebookController, NotebookControllerAffinity, NotebookDocument } from 'vscode';
import { IPythonExtensionChecker } from '../../api/types';
import { IApplicationShell, ICommandManager, IVSCodeNotebook } from '../../common/application/types';
import { PYTHON_LANGUAGE } from '../../common/constants';
import { disposeAllDisposables } from '../../common/helpers';
import { IDisposable, IDisposableRegistry } from '../../common/types';
import { Common, DataScience } from '../../common/utils/localize';
import { noop } from '../../common/utils/misc';
import { sendTelemetryEvent } from '../../telemetry';
import { PythonExtension, Telemetry } from '../constants';
import { JupyterNotebookView } from './constants';
import { getNotebookMetadata, isPythonNotebook } from './helpers/helpers';

export class NoPythonKernelsNotebookController implements Disposable {
    private readonly disposables: IDisposable[] = [];
    private readonly controller: NotebookController;
    constructor(
        private readonly notebookApi: IVSCodeNotebook,
        private readonly commandManager: ICommandManager,
        disposableRegistry: IDisposableRegistry,
        private readonly pythonExtensionChecker: IPythonExtensionChecker,
        private readonly appShell: IApplicationShell
    ) {
        disposableRegistry.push(this);
        this.controller = this.notebookApi.createNotebookController(
            PYTHON_LANGUAGE,
            JupyterNotebookView,
            PYTHON_LANGUAGE,
            this.handleExecution.bind(this)
        );
        this.disposables.push(this.controller);
        this.controller.description = '';
        this.controller.detail = '';
    }

    public dispose() {
        disposeAllDisposables(this.disposables);
    }

    public async updateNotebookAffinity(notebook: NotebookDocument, affinity: NotebookControllerAffinity) {
        this.controller.updateNotebookAffinity(notebook, affinity);
        this.updateLabels(notebook);
    }
    private updateLabels(document: NotebookDocument) {
        const metadata = getNotebookMetadata(document);
        if (!isPythonNotebook(metadata)) {
            return;
        }
        this.controller.label = PYTHON_LANGUAGE;
        this.controller.description =
            metadata?.kernelspec?.display_name || metadata?.kernelspec?.name || PYTHON_LANGUAGE;
    }
    private async handleExecution(_cells: NotebookCell[]) {
        if (this.pythonExtensionChecker.isPythonExtensionInstalled) {
            await this.handleExecutionWithoutPython();
        } else {
            await this.handleExecutionWithoutPythonExtension();
        }
    }
    private async handleExecutionWithoutPythonExtension() {
        sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'displayed' });
        const selection = await this.appShell.showErrorMessage(
            DataScience.pythonExtensionRequiredToRunNotebook(),
            Common.install()
        );
        if (selection === Common.install()) {
            sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'download' });
            this.commandManager.executeCommand('extension.open', PythonExtension).then(noop, noop);
        } else {
            sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'dismissed' });
        }
    }
    private async handleExecutionWithoutPython() {
        sendTelemetryEvent(Telemetry.PythonNotInstalled, undefined, { action: 'displayed' });
        const selection = await this.appShell.showErrorMessage(DataScience.pythonNotInstalled(), Common.install());
        if (selection === Common.install()) {
            sendTelemetryEvent(Telemetry.PythonNotInstalled, undefined, { action: 'download' });
            this.appShell.openUrl('https://www.python.org/downloads');
        } else {
            sendTelemetryEvent(Telemetry.PythonNotInstalled, undefined, { action: 'dismissed' });
        }
    }
}
