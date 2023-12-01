// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { Uri } from 'vscode';
import { JupyterSettings } from '../configSettings';
import { IWatchableJupyterSettings } from '../types';
import { SystemVariables } from '../variables/systemVariables.node';
import { BaseConfigurationService } from './service.base';

/**
 * Node specific implementation of the configuration service. Required because SystemVariables are different between node/web
 */
@injectable()
export class ConfigurationService extends BaseConfigurationService {
    public getSettings(resource?: Uri): IWatchableJupyterSettings {
        return JupyterSettings.getInstance(resource, SystemVariables, 'node');
    }
}
