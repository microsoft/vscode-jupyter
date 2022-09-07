// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

export const HiddenFileFormatString = '_HiddenFile_{0}.py';

export const MillisecondsInADay = 24 * 60 * 60 * 1_000;

declare const IS_PRE_RELEASE_VERSION_OF_JUPYTER_EXTENSION: 'true' | 'false';
export function isPreReleaseVersionOfExtension(): boolean {
    try {
        return IS_PRE_RELEASE_VERSION_OF_JUPYTER_EXTENSION === 'true';
    } catch {
        return false;
    }
}
