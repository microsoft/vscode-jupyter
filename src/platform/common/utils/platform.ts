// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export enum OSType {
    Unknown = 'Unknown',
    Windows = 'Windows',
    OSX = 'OSX',
    Linux = 'Linux'
}

// Return the OS type for the given platform string.
export function getOSType(platform: string = process.platform): OSType {
    if (/^win/.test(platform)) {
        return OSType.Windows;
    } else if (/^darwin/.test(platform)) {
        return OSType.OSX;
    } else if (/^linux/.test(platform)) {
        return OSType.Linux;
    } else {
        return OSType.Unknown;
    }
}

export function untildify(path: string, home: string) {
    return path.replace(/^~(?=$|\/|\\)/, home);
}
