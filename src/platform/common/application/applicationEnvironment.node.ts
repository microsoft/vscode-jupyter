// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import * as path from '../../../platform/vscode-path/path';
import { IPlatformService } from '../platform/types';
import { IExtensionContext, IPathUtils } from '../types';
import { OSType } from '../utils/platform';
import { BaseApplicationEnvironment } from './applicationEnvironment.base';

@injectable()
export class ApplicationEnvironment extends BaseApplicationEnvironment {
    constructor(
        @inject(IPlatformService) private readonly platform: IPlatformService,
        @inject(IPathUtils) private readonly pathUtils: IPathUtils,
        @inject(IExtensionContext) private readonly extensionContext: IExtensionContext
    ) {
        super();
    }

    public get userSettingsFile(): string | undefined {
        const vscodeFolderName = this.channel === 'insiders' ? 'Code - Insiders' : 'Code';
        switch (this.platform.osType) {
            case OSType.OSX:
                return path.join(
                    this.pathUtils.home,
                    'Library',
                    'Application Support',
                    vscodeFolderName,
                    'User',
                    'settings.json'
                );
            case OSType.Linux:
                return path.join(this.pathUtils.home, '.config', vscodeFolderName, 'User', 'settings.json');
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
