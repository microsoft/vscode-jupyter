// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Uri } from 'vscode';
import * as path from '../../../platform/vscode-path/path';
import * as uriPath from '../../../platform/vscode-path/resources';
import { IPlatformService } from '../platform/types';
import { IExtensionContext } from '../types';
import { OSType } from '../utils/platform';
import { getUserHomeDir } from '../utils/platform.node';
import { BaseApplicationEnvironment } from './applicationEnvironment.base';

/**
 * BaseApplicationEnvironment for Node.js
 */
@injectable()
export class ApplicationEnvironment extends BaseApplicationEnvironment {
    private homeDir = getUserHomeDir() || Uri.file('');

    constructor(
        @inject(IPlatformService) private readonly platform: IPlatformService,
        @inject(IExtensionContext) private readonly extensionContext: IExtensionContext
    ) {
        super();
    }

    public get userSettingsFile(): Uri | undefined {
        const vscodeFolderName = this.channel === 'insiders' ? 'Code - Insiders' : 'Code';
        switch (this.platform.osType) {
            case OSType.OSX:
                return uriPath.joinPath(
                    this.homeDir,
                    'Library',
                    'Application Support',
                    vscodeFolderName,
                    'User',
                    'settings.json'
                );
            case OSType.Linux:
                return uriPath.joinPath(this.homeDir, '.config', vscodeFolderName, 'User', 'settings.json');
            case OSType.Windows:
                return process.env.APPDATA
                    ? uriPath.joinPath(Uri.file(process.env.APPDATA), vscodeFolderName, 'User', 'settings.json')
                    : undefined;
            default:
                return;
        }
    }
    public get userCustomKeybindingsFile(): Uri | undefined {
        return uriPath.resolvePath(this.extensionContext.globalStorageUri, path.join('..', '..', 'keybindings.json'));
    }
}
