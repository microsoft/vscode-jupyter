// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Uri } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { Experiments } from '../../common/experiments/groups';
import { IExperimentService } from '../../common/types';
import { IJupyterServerAuthServiceProvider } from '../ui/types';

@injectable()
export class JupyterRemoteServiceHelper implements IExtensionSingleActivationService {
    private _isRemoteExperimentEnabled?: boolean;
    constructor(
        @inject(IJupyterServerAuthServiceProvider) private readonly authService: IJupyterServerAuthServiceProvider,
        @inject(IExperimentService) private readonly experiment: IExperimentService
    ) {}
    public async activate(): Promise<void> {
        // This slows down loading of extension.
        this._isRemoteExperimentEnabled = await this.experiment.inExperiment(Experiments.NativeNotebook);
    }
    public get isRemoteExperimentEnabled() {
        if (typeof this._isRemoteExperimentEnabled !== 'boolean') {
            throw new Error('We should not be calling isRemoteExperimentEnabled in ctors or the like');
        }
        return this._isRemoteExperimentEnabled;
    }

    public async isRemoteJupyterUri(uri: Uri): Promise<boolean> {
        if (!this.isRemoteExperimentEnabled) {
            return false;
        }
        const servers = await this.authService.getRemoteConnections();
        return servers.some((item) => item.fileScheme.toLowerCase() === uri.scheme.toLowerCase());
    }
}
