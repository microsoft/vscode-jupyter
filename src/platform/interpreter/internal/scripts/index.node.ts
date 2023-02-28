// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from '../../../vscode-path/path';
import { EXTENSION_ROOT_DIR } from '../../../constants.node';
import { fileToCommandArgument } from '../../../common/helpers';

// It is simpler to hard-code it instead of using vscode.ExtensionContext.extensionPath.
export const _SCRIPTS_DIR = path.join(EXTENSION_ROOT_DIR, 'pythonFiles');
const SCRIPTS_DIR = _SCRIPTS_DIR;

// "scripts" contains everything relevant to the scripts found under
// the top-level "pythonFiles" directory.  Each of those scripts has
// a function in this module which matches the script's filename.
// Each function provides the commandline arguments that should be
// used when invoking a Python executable, whether through spawn/exec
// or a terminal.
//
// Where relevant (nearly always), the function also returns a "parse"
// function that may be used to deserialize the stdout of the script
// into the corresponding object or objects.  "parse()" takes a single
// string as the stdout text and returns the relevant data.
//
// Some of the scripts are located in subdirectories of "pythonFiles".
// For each of those subdirectories there is a sub-module where
// those scripts' functions may be found.
//
// In some cases one or more types related to a script are exported
// from the same module in which the script's function is located.
// These types typically relate to the return type of "parse()".
//
// ignored scripts:
//  * install_debugpy.py  (used only for extension development)

//============================
// interpreterInfo.py

type ReleaseLevel = 'alpha' | 'beta' | 'candidate' | 'final';
type PythonVersionInfo = [number, number, number, ReleaseLevel, number];
export type PythonEnvInfo = {
    versionInfo: PythonVersionInfo;
    sysPrefix: string;
    sysVersion: string;
    is64Bit: boolean;
    exe: string;
};

//============================
// normalizeSelection.py

export function normalizeSelection(): [string[], (out: string) => string] {
    const script = path.join(SCRIPTS_DIR, 'normalizeSelection.py');
    const args = [script];

    function parse(out: string) {
        // The text will be used as-is.
        return out;
    }

    return [args, parse];
}

//============================
// printEnvVariables.py

export function printEnvVariables(): [string[], (out: string) => NodeJS.ProcessEnv] {
    const script = fileToCommandArgument(path.join(SCRIPTS_DIR, 'printEnvVariables.py'));
    const args = [script];

    function parse(out: string): NodeJS.ProcessEnv {
        return JSON.parse(out);
    }

    return [args, parse];
}

//============================
// printEnvVariablesToFile.py

export function printEnvVariablesToFile(filename: string): [string[], (out: string) => NodeJS.ProcessEnv] {
    const script = path.join(SCRIPTS_DIR, 'printEnvVariablesToFile.py');
    const args = [script, fileToCommandArgument(filename)];

    function parse(out: string): NodeJS.ProcessEnv {
        return JSON.parse(out);
    }

    return [args, parse];
}
