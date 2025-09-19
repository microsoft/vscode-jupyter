// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import * as os from 'os';

import { Uri } from 'vscode';
import { getOSType, OSType } from '../utils/platform';
import { getUserHomeDir } from '../utils/platform.node';
import { IPlatformService } from './types';

/**
 * Wrapper around the node os module. Allows same functions to be used in web.
 */
@injectable()
export class PlatformService implements IPlatformService {
    private readonly _homeDir = getUserHomeDir() || Uri.file(os.homedir());
    private readonly _tempDir = Uri.file(os.tmpdir());
    public get homeDir() {
        return this._homeDir;
    }
    public get tempDir() {
        return this._tempDir;
    }
    public readonly osType: OSType = getOSType();
    constructor() {
        if (this.osType === OSType.Unknown) {
        }
    }
    public get pathVariableName() {
        const WINDOWS_PATH_VARIABLE_NAME = 'Path';
        const NON_WINDOWS_PATH_VARIABLE_NAME = 'PATH';

        return this.isWindows ? WINDOWS_PATH_VARIABLE_NAME : NON_WINDOWS_PATH_VARIABLE_NAME;
    }

    public get isWindows(): boolean {
        return this.osType === OSType.Windows;
    }
    public get isMac(): boolean {
        return this.osType === OSType.OSX;
    }
    public get isLinux(): boolean {
        return this.osType === OSType.Linux;
    }
}
