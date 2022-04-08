// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import * as path from '../../../platform/vscode-path/path';
import { IPlatformService } from '../platform/types';
import { IExtensionContext } from '../types';
import { OSType } from '../utils/platform';
import { getUserHomeDir } from '../utils/platform.node';
import { BaseApplicationEnvironment } from './applicationEnvironment.base';

@injectable()
export class ApplicationEnvironment extends BaseApplicationEnvironment {
    private homeDir = getUserHomeDir()?.fsPath || '';

    constructor(
        @inject(IPlatformService) private readonly platform: IPlatformService,
        @inject(IExtensionContext) private readonly extensionContext: IExtensionContext
    ) {
        super();
    }

    public get userSettingsFile(): string | undefined {
        const vscodeFolderName = this.channel === 'insiders' ? 'Code - Insiders' : 'Code';
        switch (this.platform.osType) {
            case OSType.OSX:
                return path.join(
                    this.homeDir,
                    'Library',
                    'Application Support',
                    vscodeFolderName,
                    'User',
                    'settings.json'
                );
            case OSType.Linux:
                return path.join(this.homeDir, '.config', vscodeFolderName, 'User', 'settings.json');
            case OSType.Windows:
                return process.env.APPDATA
                    ? path.join(process.env.APPDATA, vscodeFolderName, 'User', 'settings.json')
                    : undefined;
            default:
                return;
        }
    }
    public get userCustomKeybindingsFile(): string | undefined {
        return path.resolve(this.extensionContext.globalStorageUri.fsPath, '..', '..', 'keybindings.json');
    }
}
