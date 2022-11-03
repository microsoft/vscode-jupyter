// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { injectable } from 'inversify';
import { OSType } from '../utils/platform';
import { IPlatformService } from './types';

/**
 * Reimplementation of the node os module but for web.
 */
@injectable()
export class PlatformService implements IPlatformService {
    public get tempDir() {
        return undefined;
    }
    public get homeDir() {
        return undefined;
    }
    public readonly osType: OSType = OSType.Unknown;
    public get pathVariableName() {
        return '';
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
