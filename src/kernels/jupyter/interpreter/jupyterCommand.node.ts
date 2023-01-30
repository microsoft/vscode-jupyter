// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SpawnOptions } from 'child_process';
import { inject, injectable } from 'inversify';
import * as path from '../../../platform/vscode-path/path';
import { traceError } from '../../../platform/logging';
import {
    IPythonExecutionService,
    IPythonExecutionFactory,
    ExecutionResult
} from '../../../platform/common/process/types.node';
import { EXTENSION_ROOT_DIR } from '../../../platform/constants.node';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { JupyterCommands } from '../../../platform/common/constants';
import { IJupyterCommand, IJupyterCommandFactory } from '../types.node';

/**
 * Launches jupyter using the current python environment.
 */
class InterpreterJupyterCommand implements IJupyterCommand {
    protected interpreterPromise: Promise<PythonEnvironment>;
    private pythonLauncher: Promise<IPythonExecutionService>;

    constructor(
        protected readonly moduleName: string,
        protected args: string[],
        protected readonly pythonExecutionFactory: IPythonExecutionFactory,
        private readonly _interpreter: PythonEnvironment
    ) {
        this.interpreterPromise = Promise.resolve(this._interpreter);
        this.pythonLauncher = this.interpreterPromise.then(async (interpreter) => {
            return pythonExecutionFactory.createActivatedEnvironment({
                allowEnvironmentFetchExceptions: true,
                interpreter
            });
        });
    }
    public interpreter(): Promise<PythonEnvironment | undefined> {
        return this.interpreterPromise;
    }

    public async exec(args: string[], options: SpawnOptions): Promise<ExecutionResult<string>> {
        const newOptions = { ...options };
        const launcher = await this.pythonLauncher;
        const newArgs = [...this.args, ...args];
        const moduleName = newArgs[1];
        newArgs.shift(); // Remove '-m'
        newArgs.shift(); // Remove module name
        return launcher.execModule(moduleName, newArgs, newOptions);
    }
}

/**
 * This class is used to launch the notebook.
 * I.e. anything to do with the command `python -m jupyter notebook` or `python -m notebook`.
 *
 * @class InterpreterJupyterNotebookCommand
 * @implements {IJupyterCommand}
 */
export class InterpreterJupyterNotebookCommand extends InterpreterJupyterCommand {
    // eslint-disable-next-line @typescript-eslint/no-useless-constructor
    constructor(
        moduleName: string,
        args: string[],
        pythonExecutionFactory: IPythonExecutionFactory,
        interpreter: PythonEnvironment
    ) {
        super(moduleName, args, pythonExecutionFactory, interpreter);
    }
}

/**
 * This class is used to handle kernelspecs.
 * I.e. anything to do with the command `python -m jupyter kernelspec`.
 *
 * @class InterpreterJupyterKernelSpecCommand
 * @implements {IJupyterCommand}
 */
// eslint-disable-next-line max-classes-per-file
export class InterpreterJupyterKernelSpecCommand extends InterpreterJupyterCommand {
    // eslint-disable-next-line @typescript-eslint/no-useless-constructor
    constructor(
        moduleName: string,
        args: string[],
        pythonExecutionFactory: IPythonExecutionFactory,
        interpreter: PythonEnvironment
    ) {
        super(moduleName, args, pythonExecutionFactory, interpreter);
    }

    /**
     * Kernelspec subcommand requires special treatment.
     * Its possible the sub command hasn't been registered (i.e. jupyter kernelspec command hasn't been installed).
     * However its possible the kernlspec modules are available.
     * So here's what we have:
     * - python -m jupyter kernelspec --version (throws an error, as kernelspect sub command not installed)
     * - `import jupyter_client.kernelspec` (works, hence kernelspec modules are available)
     * - Problem is daemon will say that `kernelspec` is avaiable, as daemon can work with the `jupyter_client.kernelspec`.
     *   But rest of extension will assume kernelspec is available and `python -m jupyter kenerlspec --version` will fall over.
     * Solution:
     * - Run using daemon wrapper code if possible (we don't know whether daemon or python process will run kernel spec).
     * - Now, its possible the python daemon process is busy in which case we fall back (in daemon wrapper) to using a python process to run the code.
     * - However `python -m jupyter kernelspec` will fall over (as such a sub command hasn't been installed), hence calling daemon code will fail.
     * - What we do in such an instance is run the python code `python xyz.py` to deal with kernels.
     *   If that works, great.
     *   If that fails, then we know that `kernelspec` sub command doesn't exist and `import jupyter_client.kernelspec` also doesn't work.
     *   In such a case re-throw the exception from the first execution (possibly the daemon wrapper).
     * @param {string[]} args
     * @param {SpawnOptions} options
     * @returns {Promise<ExecutionResult<string>>}
     * @memberof InterpreterJupyterKernelSpecCommand
     */
    public override async exec(args: string[], options: SpawnOptions): Promise<ExecutionResult<string>> {
        let exception: Error | undefined;
        let output: ExecutionResult<string> = { stdout: '' };
        try {
            output = await super.exec(args, options);
        } catch (ex) {
            exception = ex;
        }

        if (!output.stderr && !exception) {
            return output;
        }

        const defaultAction = () => {
            if (exception) {
                traceError(`Exception attempting to enumerate kernelspecs: `, exception);
                throw exception;
            }
            return output;
        };

        // We're only interested in `python -m jupyter kernelspec`
        const interpreter = await this.interpreter();
        if (
            !interpreter ||
            this.moduleName.toLowerCase() !== 'jupyter' ||
            this.args.join(' ').toLowerCase() !== `-m jupyter ${JupyterCommands.KernelSpecCommand}`.toLowerCase()
        ) {
            return defaultAction();
        }

        // Otherwise try running a script instead.
        try {
            if (args.join(' ').toLowerCase() === 'list --json') {
                // Try getting kernels using python script, if that fails (even if there's output in stderr) rethrow original exception.
                output = await this.getKernelSpecList(interpreter, options);
                return output;
            } else if (args.join(' ').toLowerCase() === '--version') {
                // Try getting kernelspec version using python script, if that fails (even if there's output in stderr) rethrow original exception.
                output = await this.getKernelSpecVersion(interpreter, options);
                return output;
            }
        } catch (innerEx) {
            traceError('Failed to get a list of the kernelspec using python script', innerEx);
        }
        return defaultAction();
    }

    private async getKernelSpecList(interpreter: PythonEnvironment, options: SpawnOptions) {
        // Try getting kernels using python script, if that fails (even if there's output in stderr) rethrow original exception.
        const activatedEnv = await this.pythonExecutionFactory.createActivatedEnvironment({
            interpreter
        });
        return activatedEnv.exec(
            [path.join(EXTENSION_ROOT_DIR, 'pythonFiles', 'vscode_datascience_helpers', 'getJupyterKernels.py')],
            { ...options, throwOnStdErr: true }
        );
    }
    private async getKernelSpecVersion(interpreter: PythonEnvironment, options: SpawnOptions) {
        // Try getting kernels using python script, if that fails (even if there's output in stderr) rethrow original exception.
        const activatedEnv = await this.pythonExecutionFactory.createActivatedEnvironment({
            interpreter
        });
        return activatedEnv.exec(
            [
                path.join(
                    EXTENSION_ROOT_DIR,
                    'pythonFiles',
                    'vscode_datascience_helpers',
                    'getJupyterKernelspecVersion.py'
                )
            ],
            { ...options, throwOnStdErr: true }
        );
    }
}

// eslint-disable-next-line max-classes-per-file
@injectable()
export class JupyterCommandFactory implements IJupyterCommandFactory {
    constructor(@inject(IPythonExecutionFactory) private readonly executionFactory: IPythonExecutionFactory) {}

    public createInterpreterCommand(
        command: JupyterCommands,
        moduleName: string,
        args: string[],
        interpreter: PythonEnvironment
    ): IJupyterCommand {
        if (command === JupyterCommands.NotebookCommand) {
            return new InterpreterJupyterNotebookCommand(moduleName, args, this.executionFactory, interpreter);
        } else if (command === JupyterCommands.KernelSpecCommand) {
            return new InterpreterJupyterKernelSpecCommand(moduleName, args, this.executionFactory, interpreter);
        }
        return new InterpreterJupyterCommand(moduleName, args, this.executionFactory, interpreter);
    }
}
