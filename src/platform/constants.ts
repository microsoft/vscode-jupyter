// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export const HiddenFileFormatString = '_HiddenFile_{0}.py';

export const MillisecondsInADay = 24 * 60 * 60 * 1_000;

declare var IS_PRE_RELEASE_VERSION_OF_JUPYTER_EXTENSION: 'true' | 'false';
export function isPreReleaseVersion() {
    try {
        if (IS_PRE_RELEASE_VERSION_OF_JUPYTER_EXTENSION === 'true') {
            return 'true';
        } else if (IS_PRE_RELEASE_VERSION_OF_JUPYTER_EXTENSION === 'false') {
            return 'false';
        } else {
            // No idea, possible webpack is not replacing the value, meaning we're in dev mode.
            return 'true';
        }
    } catch {
        // Dev version is treated as pre-release.
        return 'true';
    }
}

export const Exiting = {
    /**
     * Whether VS Code is shutting down or the like (e.g. reloading).
     */
    isExiting: false
};
