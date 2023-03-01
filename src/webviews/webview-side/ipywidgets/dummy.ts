// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * We need to tell VS Code some way to register the Jupyter extension directory
 * as a known root directory where from scripts can be loaded.
 * If we do not do this and attempt to load scripts from the Jupyter extension directory,
 * then VS Code will return a 401 error.
 * One way to do this is to create a script file and define this as a pre-load script for the controller in the controller code.
 * NOTE: Defining pre-load scripts in the package.json file does not work.
 */
export function activate() {
    //
}
