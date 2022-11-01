// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IConfigurationService, Resource } from '../platform/common/types';
import { IKernelSettings } from './types';

export function createKernelSettings(configService: IConfigurationService, resource: Resource): IKernelSettings {
    return {
        get enableExtendedKernelCompletions() {
            return configService.getSettings(resource).enableExtendedKernelCompletions;
        },
        get generateSVGPlots() {
            return configService.getSettings(resource).generateSVGPlots;
        },
        get ignoreVscodeTheme() {
            return configService.getSettings(resource).ignoreVscodeTheme;
        },
        get interruptTimeout() {
            return configService.getSettings(resource).jupyterInterruptTimeout;
        },
        get launchTimeout() {
            return configService.getSettings(resource).jupyterLaunchTimeout;
        },
        get runStartupCommands() {
            return configService.getSettings(resource).runStartupCommands;
        },
        get themeMatplotlibPlots() {
            return configService.getSettings(resource).themeMatplotlibPlots;
        }
    };
}
