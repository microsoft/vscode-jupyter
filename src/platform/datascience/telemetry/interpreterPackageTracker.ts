// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { NotebookDocument } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IPythonExtensionChecker, IPythonApiProvider } from '../../api/types';
import { IExtensions, IDisposableRegistry, InterpreterUri } from '../../common/types';
import { isResource, noop } from '../../common/utils/misc';
import { IInterpreterService } from '../../interpreter/contracts';
import { InterpreterPackages } from './interpreterPackages';
import { INotebookControllerManager } from '../../../notebooks/types';
import { trackKernelResourceInformation } from './telemetry';
import { IInstaller, Product } from '../../../kernels/installer/types';
import { VSCodeNotebookController } from '../../../notebooks/controllers/vscodeNotebookController';

@injectable()
export class InterpreterPackageTracker implements IExtensionSingleActivationService {
    private activeInterpreterTrackedUponActivation?: boolean;
    constructor(
        @inject(InterpreterPackages) private readonly packages: InterpreterPackages,
        @inject(IInstaller) private readonly installer: IInstaller,
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(IPythonExtensionChecker) private readonly pythonExtensionChecker: IPythonExtensionChecker,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IPythonApiProvider) private readonly apiProvider: IPythonApiProvider,
        @inject(INotebookControllerManager) private readonly notebookControllerManager: INotebookControllerManager
    ) {}
    public async activate(): Promise<void> {
        this.notebookControllerManager.onNotebookControllerSelected(
            this.onNotebookControllerSelected,
            this,
            this.disposables
        );
        this.interpreterService.onDidChangeInterpreter(this.trackPackagesOfActiveInterpreter, this, this.disposables);
        this.installer.onInstalled(this.onDidInstallPackage, this, this.disposables);
        this.extensions.onDidChange(this.trackUponActivation, this, this.disposables);
        this.trackUponActivation().catch(noop);
        this.apiProvider.onDidActivatePythonExtension(this.trackUponActivation, this, this.disposables);
    }
    private async onNotebookControllerSelected(event: {
        notebook: NotebookDocument;
        controller: VSCodeNotebookController;
    }) {
        if (!event.controller.connection.interpreter) {
            return;
        }
        trackKernelResourceInformation(event.notebook.uri, { kernelConnection: event.controller.connection });
        await this.packages.trackPackages(event.controller.connection.interpreter);
    }
    private async trackUponActivation() {
        if (this.activeInterpreterTrackedUponActivation) {
            return;
        }
        if (!this.pythonExtensionChecker.isPythonExtensionActive) {
            return;
        }
        this.activeInterpreterTrackedUponActivation = true;
        await this.trackPackagesOfActiveInterpreter();
    }
    private async trackPackagesOfActiveInterpreter() {
        if (!this.pythonExtensionChecker.isPythonExtensionActive) {
            return;
        }
        // Get details of active interpreter.
        const activeInterpreter = await this.interpreterService.getActiveInterpreter(undefined);
        if (!activeInterpreter) {
            return;
        }
        await this.packages.trackPackages(activeInterpreter);
    }
    private async onDidInstallPackage(args: { product: Product; resource?: InterpreterUri }) {
        if (!this.pythonExtensionChecker.isPythonExtensionActive) {
            return;
        }
        if (isResource(args.resource)) {
            // Get details of active interpreter for the Uri provided.
            const activeInterpreter = await this.interpreterService.getActiveInterpreter(args.resource);
            await this.packages.trackPackages(activeInterpreter, true);
        } else {
            await this.packages.trackPackages(args.resource, true);
        }
    }
}
