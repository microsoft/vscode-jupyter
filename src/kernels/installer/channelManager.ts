// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { EnvironmentType, PythonEnvironment } from '../../client/pythonEnvironments/info';
import { IApplicationShell } from '../../client/common/application/types';
import { IPlatformService } from '../../client/common/platform/types';
import { Installer } from '../../client/common/utils/localize';
import { IServiceContainer } from '../../client/ioc/types';
import { ProductNames } from './productNames';
import { IInstallationChannelManager, IModuleInstaller, Product } from './types';

@injectable()
export class InstallationChannelManager implements IInstallationChannelManager {
    constructor(@inject(IServiceContainer) private serviceContainer: IServiceContainer) {}

    public async getInstallationChannel(
        product: Product,
        interpreter: PythonEnvironment
    ): Promise<IModuleInstaller | undefined> {
        const channels = await this.getInstallationChannels(interpreter);
        if (channels.length === 1) {
            return channels[0];
        }

        const productName = ProductNames.get(product)!;
        const appShell = this.serviceContainer.get<IApplicationShell>(IApplicationShell);
        if (channels.length === 0) {
            await this.showNoInstallersMessage(interpreter);
            return;
        }

        const placeHolder = `Select an option to install ${productName}`;
        const options = channels.map((installer) => {
            return {
                label: `Install using ${installer.displayName}`,
                description: '',
                installer
            };
        });
        const selection = await appShell.showQuickPick<typeof options[0]>(options, {
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder
        });
        return selection ? selection.installer : undefined;
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
        const appShell = this.serviceContainer.get<IApplicationShell>(IApplicationShell);
        const search = 'Search for help';
        let result: string | undefined;
        if (interpreter.envType === EnvironmentType.Conda) {
            result = await appShell.showErrorMessage(Installer.noCondaOrPipInstaller(), Installer.searchForHelp());
        } else {
            result = await appShell.showErrorMessage(Installer.noPipInstaller(), Installer.searchForHelp());
        }
        if (result === search) {
            const platform = this.serviceContainer.get<IPlatformService>(IPlatformService);
            const osName = platform.isWindows ? 'Windows' : platform.isMac ? 'MacOS' : 'Linux';
            appShell.openUrl(
                `https://www.bing.com/search?q=Install Pip ${osName} ${
                    interpreter.envType === EnvironmentType.Conda ? 'Conda' : ''
                }`
            );
        }
    }
}
