// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, optional } from 'inversify';
import { NotebookDocument } from 'vscode';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IPythonExtensionChecker } from '../../platform/api/types';
import { IDisposableRegistry, InterpreterUri } from '../../platform/common/types';
import { isResource } from '../../platform/common/utils/misc';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { IInstaller, Product } from '../../platform/interpreter/installer/types';
import { IControllerRegistration, IVSCodeNotebookController } from '../controllers/types';
import { trackKernelResourceInformation } from '../../kernels/telemetry/helper';
import { IInterpreterPackages } from '../../platform/interpreter/types';

/**
 * Watches interpreter and notebook selection events in order to ask the IInterpreterPackages service to track
 * the packages in an interpreter.
 */
@injectable()
export class InterpreterPackageTracker implements IExtensionSyncActivationService {
    constructor(
        @inject(IInterpreterPackages) private readonly packages: IInterpreterPackages,
        @inject(IInstaller) @optional() private readonly installer: IInstaller | undefined,
        @inject(IPythonExtensionChecker) private readonly pythonExtensionChecker: IPythonExtensionChecker,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IControllerRegistration) private readonly notebookControllerManager: IControllerRegistration
    ) {}
    public activate() {
        this.notebookControllerManager.onControllerSelected(this.onNotebookControllerSelected, this, this.disposables);
        this.installer?.onInstalled(this.onDidInstallPackage, this, this.disposables); // Not supported in Web
    }
    private async onNotebookControllerSelected(event: {
        notebook: NotebookDocument;
        controller: IVSCodeNotebookController;
    }) {
        if (!event.controller.connection.interpreter) {
            return;
        }
        await trackKernelResourceInformation(event.notebook.uri, { kernelConnection: event.controller.connection });
        await this.packages.trackPackages(event.controller.connection.interpreter);
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
