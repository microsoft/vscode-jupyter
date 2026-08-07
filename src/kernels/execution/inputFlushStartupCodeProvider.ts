// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IKernel, IStartupCodeProvider, IStartupCodeProviders, StartupCodePriority } from '../types';
import { isPythonKernelConnection } from '../helpers';
import { InteractiveWindowView, JupyterNotebookView } from '../../platform/common/constants';

/**
 * Startup code that monkey-patches Python's input() function to flush stdout before requesting input.
 * This ensures that any pending output (like print statements) is displayed before the input prompt.
 */
const inputFlushStartupCode = `
# Monkey patch input() to flush stdout before requesting input
import builtins
import sys

def __vscode_input_with_flush(*args, **kwargs):
    """
    Wrapper around input() that flushes stdout before requesting input.
    This ensures that any pending output is displayed before the input prompt.
    """
    try:
        # Flush stdout to ensure all output is displayed before the input prompt
        sys.stdout.flush()
    except:
        # If flushing fails for any reason, continue without error
        pass
    
    # Call the original input function
    return __vscode_original_input(*args, **kwargs)

# Store reference to original input and replace with our wrapper
__vscode_original_input = builtins.input
builtins.input = __vscode_input_with_flush

# Clean up temporary variables
del __vscode_input_with_flush
`.trim();

@injectable()
export class InputFlushStartupCodeProvider implements IStartupCodeProvider, IExtensionSyncActivationService {
    public priority = StartupCodePriority.Base;

    constructor(@inject(IStartupCodeProviders) private readonly registry: IStartupCodeProviders) {}

    activate(): void {
        this.registry.register(this, JupyterNotebookView);
        this.registry.register(this, InteractiveWindowView);
    }

    async getCode(kernel: IKernel): Promise<string[]> {
        // Only apply this monkey patch to Python kernels
        if (!isPythonKernelConnection(kernel.kernelConnectionMetadata)) {
            return [];
        }
        return [inputFlushStartupCode];
    }
}
