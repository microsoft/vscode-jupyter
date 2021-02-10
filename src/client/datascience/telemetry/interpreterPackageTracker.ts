// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject } from 'inversify';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IPythonInstaller, IPythonExtensionChecker } from '../../api/types';
import { IVSCodeNotebook } from '../../common/application/types';
import { InterpreterUri } from '../../common/installer/types';
import { IExtensions, IDisposableRegistry, Product, IConfigurationService } from '../../common/types';
import { swallowExceptions } from '../../common/utils/decorators';
import { isResource, noop } from '../../common/utils/misc';
import { IInterpreterService } from '../../interpreter/contracts';
import { isLocalLaunch } from '../jupyter/kernels/helpers';
import { InterpreterPackages } from './interpreterPackages';
import { NotebookKernel as VSCNotebookKernel } from '../../../../types/vscode-proposed';
import { isJupyterKernel } from '../notebook/helpers/helpers';

export class InterpreterPackageTracker implements IExtensionSingleActivationService {
    private activeInterpreterTrackedUponActivation?: boolean;
    constructor(
        @inject(InterpreterPackages) private readonly packages: InterpreterPackages,
        @inject(IPythonInstaller) private readonly installer: IPythonInstaller,
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(IPythonExtensionChecker) private readonly pythonExtensionChecker: IPythonExtensionChecker,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IVSCodeNotebook) private readonly notebook: IVSCodeNotebook,
        @inject(IConfigurationService) private readonly configurationService: IConfigurationService
    ) {}
    public async activate(): Promise<void> {
        if (!isLocalLaunch(this.configurationService)) {
            return;
        }
        this.notebook.onDidChangeActiveNotebookKernel(this.onDidChangeActiveNotebookKernel, this, this.disposables);
        this.installer.onInstalled(this.onDidInstallPackage, this, this.disposables);
        this.extensions.onDidChange(this.trackUponActivation, this, this.disposables);
        this.trackUponActivation().catch(noop);
    }
    private async onDidChangeActiveNotebookKernel({ kernel }: { kernel: VSCNotebookKernel | undefined }) {
        if (!kernel || !isJupyterKernel(kernel) || !kernel.selection.interpreter) {
            return;
        }
        await this.packages.trackPackages(kernel.selection.interpreter);
    }
    private async trackUponActivation() {
        if (this.activeInterpreterTrackedUponActivation) {
            return;
        }
        if (!this.pythonExtensionChecker.isPythonExtensionInstalled) {
            return;
        }
        this.activeInterpreterTrackedUponActivation = true;
        await this.trackPackagesOfActiveInterpreter();
    }
    private async trackPackagesOfActiveInterpreter() {
        if (!this.pythonExtensionChecker.isPythonExtensionInstalled) {
            return;
        }
        // Get details of active interpreter for the Uri provided.
        const activeInterpreter = await this.interpreterService.getActiveInterpreter(undefined);
        if (!activeInterpreter) {
            return;
        }
        await this.packages.trackPackages(activeInterpreter);
    }
    @swallowExceptions()
    private async onDidInstallPackage(args: { product: Product; resource?: InterpreterUri }) {
        if (!this.pythonExtensionChecker.isPythonExtensionInstalled) {
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
