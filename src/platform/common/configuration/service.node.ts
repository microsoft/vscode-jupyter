// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Uri } from 'vscode';
import { IServiceContainer } from '../../ioc/types';
import { JupyterSettings } from '../configSettings';
import { IWatchableJupyterSettings } from '../types';
import { SystemVariables } from '../variables/systemVariables.node';
import { BaseConfigurationService } from './service.base';

/**
 * Node specific implementation of the configuration service. Required because SystemVariables are different between node/web
 */
@injectable()
export class ConfigurationService extends BaseConfigurationService {
    // eslint-disable-next-line @typescript-eslint/no-useless-constructor
    constructor(@inject(IServiceContainer) serviceContainer: IServiceContainer) {
        super(serviceContainer);
    }
    public getSettings(resource?: Uri): IWatchableJupyterSettings {
        return JupyterSettings.getInstance(resource, SystemVariables, 'node', this.workspaceService);
    }
}
