// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { EnvironmentType, PythonEnvironment } from '../../pythonEnvironments/info';
import {} from '../../common/application/types';
import { IPlatformService } from '../../common/platform/types';
import { Installer } from '../../common/utils/localize';
import { IServiceContainer } from '../../ioc/types';
import { IInstallationChannelManager, IModuleInstaller, Product } from './types';
import { Uri, env, window, l10n } from 'vscode';
import { getEnvironmentType } from '../helpers';

/**
 * Finds IModuleInstaller instances for a particular environment (like pip, poetry, conda).
 */
@injectable()
export class InstallationChannelManager implements IInstallationChannelManager {
    constructor(@inject(IServiceContainer) private serviceContainer: IServiceContainer) {}

    public async getInstallationChannel(
        _product: Product,
        interpreter: PythonEnvironment
    ): Promise<IModuleInstaller | undefined> {
        const channels = await this.getInstallationChannels(interpreter);

        // Always use the first one so we don't confuse the user.
        if (channels.length >= 1) {
            return channels[0];
        }

        if (channels.length === 0) {
            await this.showNoInstallersMessage(interpreter);
            return;
        }
    }

    public async getInstallationChannels(interpreter: PythonEnvironment): Promise<IModuleInstaller[]> {
        const installers = this.serviceContainer.getAll<IModuleInstaller>(IModuleInstaller);
        const supportedInstallers: IModuleInstaller[] = [];
        if (installers.length === 0) {
            return [];
        }
        // group by priority and pick supported from the highest priority
        installers.sort((a, b) => b.priority - a.priority);
        let currentPri = installers[0].priority;
        for (const mi of installers) {
            if (mi.priority !== currentPri) {
                if (supportedInstallers.length > 0) {
                    break; // return highest priority supported installers
                }
                // If none supported, try next priority group
                currentPri = mi.priority;
            }
            if (await mi.isSupported(interpreter)) {
                supportedInstallers.push(mi);
            }
        }
        return supportedInstallers;
    }

    public async showNoInstallersMessage(interpreter: PythonEnvironment): Promise<void> {
        const envType = getEnvironmentType(interpreter);
        let message: string;
        let searchTerm: string;

        switch (envType) {
            case EnvironmentType.Conda:
                message = Installer.noCondaOrPipInstaller;
                searchTerm = 'Install Pip Conda';
                break;
            case EnvironmentType.UV:
                message = l10n.t('There is no UV installer available in the selected environment.');
                searchTerm = 'Install UV Python';
                break;
            default:
                message = Installer.noPipInstaller;
                searchTerm = 'Install Pip';
                break;
        }

        const result = await window.showErrorMessage(
            message,
            { modal: true },
            Installer.searchForHelp
        );
        if (result === Installer.searchForHelp) {
            const platform = this.serviceContainer.get<IPlatformService>(IPlatformService);
            const osName = platform.isWindows ? 'Windows' : platform.isMac ? 'MacOS' : 'Linux';
            void env.openExternal(
                Uri.parse(
                    `https://www.bing.com/search?q=${searchTerm} ${osName}`
                )
            );
        }
    }
}
