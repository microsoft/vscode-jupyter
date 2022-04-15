// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { injectable } from 'inversify';
import { SemVer } from 'semver';
import { OSType } from '../utils/platform';
import { IPlatformService } from './types';

@injectable()
export class PlatformService implements IPlatformService {
    public get homeDir() {
        return undefined;
    }
    public readonly osType: OSType = OSType.Unknown;
    public version?: SemVer;
    public get pathVariableName() {
        return '';
    }
    public get virtualEnvBinName() {
        return this.isWindows ? 'Scripts' : 'bin';
    }
    public async getVersion(): Promise<SemVer> {
        throw new Error('Not Supported');
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
    public get osRelease(): string {
        return '';
    }
    public get is64bit(): boolean {
        return false;
    }
}
