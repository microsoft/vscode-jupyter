// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { createInterpreterKernelSpec, getKernelId } from '../../kernels/helpers';
import { PythonKernelConnectionMetadata } from '../../kernels/types';
import { JupyterNotebookView, InteractiveWindowView } from '../../platform/common/constants';
import { Resource } from '../../platform/common/types';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { IControllerRegistration, IVSCodeNotebookController } from './types';

// This is here so the default service and the loader service can both use it without having
// a circular reference with each other
export async function createActiveInterpreterController(
    viewType: typeof JupyterNotebookView | typeof InteractiveWindowView,
    resource: Resource,
    interpreters: IInterpreterService,
    registration: IControllerRegistration
): Promise<IVSCodeNotebookController | undefined> {
    const pythonInterpreter = await interpreters.getActiveInterpreter(resource);
    if (pythonInterpreter) {
        // Ensure that the controller corresponding to the active interpreter
        // has been successfully created
        const spec = createInterpreterKernelSpec(pythonInterpreter);
        const metadata: PythonKernelConnectionMetadata = {
            kind: 'startUsingPythonInterpreter',
            kernelSpec: spec,
            interpreter: pythonInterpreter,
            id: getKernelId(spec, pythonInterpreter)
        };
        return registration.add(metadata, [viewType])[0]; // Should only create one because only one view type
    }
}
