// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import * as os from 'os';
import { coerce, SemVer } from 'semver';
import { Uri } from 'vscode';
import { getOSType, OSType } from '../utils/platform';
import { getUserHomeDir } from '../utils/platform.node';
import { parseVersion } from '../utils/version.node';
import { NON_WINDOWS_PATH_VARIABLE_NAME, WINDOWS_PATH_VARIABLE_NAME } from './constants.node';
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
    public version?: SemVer;
    constructor() {
        if (this.osType === OSType.Unknown) {
        }
    }
    public get pathVariableName() {
        return this.isWindows ? WINDOWS_PATH_VARIABLE_NAME : NON_WINDOWS_PATH_VARIABLE_NAME;
    }
    public async getVersion(): Promise<SemVer> {
        if (this.version) {
            return this.version;
        }
        switch (this.osType) {
            case OSType.Windows:
            case OSType.OSX:
                // Release section of https://en.wikipedia.org/wiki/MacOS_Sierra.
                // Version 10.12 maps to Darwin 16.0.0.
                // Using os.release() we get the darwin release #.
                try {
                    const ver = coerce(os.release());
                    if (ver) {
                        return (this.version = ver);
                    }
                    throw new Error('Unable to parse version');
                } catch (ex) {
                    return parseVersion(os.release());
                }
            default:
                throw new Error('Not Supported');
        }
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
