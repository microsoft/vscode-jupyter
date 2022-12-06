// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export {};

/* eslint-disable @typescript-eslint/no-unused-vars */
declare let __webpack_public_path__: string;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
if ((window as any).__PVSC_Public_Path) {
    // This variable tells Webpack to this as the root path used to request webpack bundles.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __webpack_public_path__ = (window as any).__PVSC_Public_Path;
}
