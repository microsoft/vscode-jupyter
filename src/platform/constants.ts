// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export const HiddenFileFormatString = '_HiddenFile_{0}.py';

export const MillisecondsInADay = 24 * 60 * 60 * 1_000;

export function isPreReleaseVersion() {
    try {
        return require('vscode-jupyter-release-version').isPreRelesVersionOfJupyterExtension === true
            ? 'true'
            : 'false';
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

export const TestingKernelPickerProviderId = '_builtin.JupyterServerSelectorForTesting';
export const UserJupyterServerPickerProviderId = '_builtin.jupyterServerUrlProvider';

export function isBuiltInJupyterProvider(id: string) {
    return id === TestingKernelPickerProviderId || id === UserJupyterServerPickerProviderId;
}

let isCodeSpaceValue = false;
export function setIsCodeSpace(value: boolean) {
    isCodeSpaceValue = value;
}

export function isCodeSpace() {
    return isCodeSpaceValue;
let isWebExtensionValue = false;
export function setIsWebExtension(value: boolean) {
    isWebExtensionValue = value;
}

export function isWebExtension() {
    return isWebExtensionValue;
}
