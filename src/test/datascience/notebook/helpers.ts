// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createInterpreterKernelSpec, getKernelId } from '../../../kernels/helpers';
import { PythonKernelConnectionMetadata } from '../../../kernels/types';
import { JupyterNotebookView, InteractiveWindowView } from '../../../platform/common/constants';
import { getDisplayPath } from '../../../platform/common/platform/fs-paths';
import { Resource } from '../../../platform/common/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { traceInfoIfCI } from '../../../platform/logging';
import { IControllerRegistration, IVSCodeNotebookController } from '../../../notebooks/controllers/types';

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
        const spec = await createInterpreterKernelSpec(pythonInterpreter);
        const metadata = PythonKernelConnectionMetadata.create({
            kernelSpec: spec,
            interpreter: pythonInterpreter,
            id: getKernelId(spec, pythonInterpreter)
        });
        const controllers = registration.addOrUpdate(metadata, [viewType]);
        const controller = controllers[0]; // Should only create one because only one view type
        registration.trackActiveInterpreterControllers(controllers);
        traceInfoIfCI(
            `Active Interpreter Controller ${controller.connection.kind}:${
                controller.id
            } created for View ${viewType} with resource ${getDisplayPath(resource)}`
        );
        return controller;
    }
}
