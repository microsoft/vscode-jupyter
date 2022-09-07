// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

export const HiddenFileFormatString = '_HiddenFile_{0}.py';

export const MillisecondsInADay = 24 * 60 * 60 * 1_000;

/**
 * The value for the key `IS_PRE_RELEASE_VERSION_OF_JUPYTER_EXTENSION` will be replaced by webpack.
 */
const isPreRelease = {
    IS_PRE_RELEASE_VERSION_OF_JUPYTER_EXTENSION: undefined
};
export function isPreReleaseVersionOfExtension(): boolean {
    try {
        if ('true' in isPreRelease) {
            return true;
        } else if ('false' in isPreRelease) {
            return false;
        }
        // Development env of extension is the same as pre-release.
        return true;
    } catch {
        return false;
    }
}
