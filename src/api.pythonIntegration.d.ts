// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { PythonApi } from './platform/api/types';

declare module './api' {
    /**
     * These types are not required for any other extension, except for the Python extension.
     * Hence the reason to keep this separate. This way we can keep the API stable for other extensions (which would be the majority case).
     */
    export interface Jupyter {
        registerPythonApi(pythonApi: PythonApi): void;
    }
}
