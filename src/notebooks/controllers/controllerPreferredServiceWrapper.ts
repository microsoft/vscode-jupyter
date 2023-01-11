// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { injectable, inject } from 'inversify';
import { CancellationToken, NotebookDocument } from 'vscode';
import { KernelConnectionMetadata } from '../../kernels/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { IDisposable, IDisposableRegistry, IFeaturesManager } from '../../platform/common/types';
import { IServiceContainer } from '../../platform/ioc/types';
import { logValue, traceDecoratorVerbose } from '../../platform/logging';
import { ControllerPreferredService } from './controllerPreferredService';
import { IControllerPreferredService, IVSCodeNotebookController } from './types';

@injectable()
export class ControllerPreferredServiceWrapper implements IControllerPreferredService, IExtensionSyncActivationService {
    private preferredService?: IControllerPreferredService;
    private readonly disposables: IDisposable[] = [];
    constructor(
        @inject(IServiceContainer) private readonly serviceContainer: IServiceContainer,

        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IFeaturesManager) private readonly featureManager: IFeaturesManager
    ) {
        disposables.push(this);
    }
    public activate() {
        let previousFeature = this.featureManager.features.kernelPickerType;
        const disposables: IDisposable[] = [];

        const createPreferredService = () => {
            const preferredService =
                this.featureManager.features.kernelPickerType === 'Stable'
                    ? this.serviceContainer.get<ControllerPreferredService>(ControllerPreferredService)
                    : undefined;
            if (preferredService) {
                preferredService.activate();
                disposables.push(preferredService);
                this.disposables.push(preferredService);
            }
            this.preferredService = this.preferredService;
        };
        createPreferredService();

        this.disposables.push(
            this.featureManager.onDidChangeFeatures(() => {
                if (this.featureManager.features.kernelPickerType === previousFeature) {
                    return;
                }
                disposeAllDisposables(disposables);
                createPreferredService();
            })
        );
    }
    public dispose() {
        disposeAllDisposables(this.disposables);
    }
    @traceDecoratorVerbose('Compute Preferred Controller')
    public async computePreferred(
        @logValue<NotebookDocument>('uri') document: NotebookDocument,
        serverId?: string | undefined,
        cancelToken?: CancellationToken
    ): Promise<{
        preferredConnection?: KernelConnectionMetadata | undefined;
        controller?: IVSCodeNotebookController | undefined;
    }> {
        if (this.preferredService) {
            return this.preferredService.computePreferred(document, serverId, cancelToken);
        } else {
            return {};
        }
    }

    public getPreferred(notebook: NotebookDocument) {
        if (this.preferredService) {
            return this.preferredService.getPreferred(notebook);
        } else {
            return undefined;
        }
    }
}
