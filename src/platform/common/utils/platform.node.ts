// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { EnvironmentVariables } from '../variables/types';
import { getOSType, OSType } from './platform';
export * from './platform';

export function getEnvironmentVariable(key: string): string | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (process.env as any as EnvironmentVariables)[key];
}

export function getPathEnvironmentVariable(): string | undefined {
    return getEnvironmentVariable('Path') || getEnvironmentVariable('PATH');
}

export function getUserHomeDir(): string | undefined {
    if (getOSType() === OSType.Windows) {
        return getEnvironmentVariable('USERPROFILE');
    }
    return getEnvironmentVariable('HOME') || getEnvironmentVariable('HOMEPATH');
}
