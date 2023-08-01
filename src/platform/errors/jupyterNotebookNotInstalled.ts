// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PythonEnvironment } from '../pythonEnvironments/info';
import { BaseError } from './types';

/**
 * Error thrown when Jupyter Notebook dependency has not been installed or not found by the python interpreter.
 * Sample error is as follows:
 * ```
 * usage: jupyter.py [-h] [--version] [--config-dir] [--data-dir] [--runtime-dir]
 *                   [--paths] [--json] [--debug]
 *                   [subcommand]
 *
 * Jupyter: Interactive Computing
 *
 * positional arguments:
 *   subcommand     the subcommand to launch
 *
 * options:
 *   -h, --help     show this help message and exit
 *   --version      show the versions of core jupyter packages and exit
 *   --config-dir   show Jupyter config dir
 *   --data-dir     show Jupyter data dir
 *   --runtime-dir  show Jupyter runtime dir
 *   --paths        show all Jupyter paths. Add --json for machine-readable
 *                  format.
 *   --json         output paths as machine-readable json
 *   --debug        output debug information about paths
 *
 * Available subcommands:
 *
 * Jupyter command `jupyter-notebook` not found.
 * ```
 */
export class JupyterNotebookNotInstalled extends BaseError {
    constructor(message: string, stderr: string | string, public readonly interpreter?: PythonEnvironment) {
        super('jupyternotebooknotinstalled', message + (stderr ? `\n${stderr}` : ''));
    }
}
