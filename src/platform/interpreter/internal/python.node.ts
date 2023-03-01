// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { traceVerbose } from '../../logging';

// "python" contains functions corresponding to the various ways that
// the extension invokes a Python executable internally.  Each function
// takes arguments relevant to the specific use case.  However, each
// always *returns* a list of strings for the commandline arguments that
// should be used when invoking the Python executable for the specific
// use case, whether through spawn/exec or a terminal.
//
// Where relevant (nearly always), the function also returns a "parse"
// function that may be used to deserialize the stdout of the command
// into the corresponding object or objects.  "parse()" takes a single
// string as the stdout text and returns the relevant data.

export function execModule(name: string, moduleArgs: string[]): string[] {
    const args = ['-m', name, ...moduleArgs];
    // "code" isn't specific enough to know how to parse it,
    // so we only return the args.
    return args;
}

export function getExecutable(): [string[], (out: string) => string] {
    const args = ['-c', 'import sys;print(sys.executable)'];

    function parse(out: string): string {
        return out.trim();
    }

    return [args, parse];
}

export function isModuleInstalled(name: string): [string[], (out: string) => boolean] {
    const args = ['-c', `import ${name};print('6af208d0-cb9c-427f-b937-ff563e17efdf')`];

    function parse(out: string): boolean {
        if (out.includes('6af208d0-cb9c-427f-b937-ff563e17efdf')) {
            return true;
        } else {
            traceVerbose(`Module ${name} is not installed. Output ${out}`);
            return false;
        }
    }

    return [args, parse];
}
