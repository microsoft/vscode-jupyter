// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * A representation of a Python runtime's version.
 *
 * @prop raw - the original version string
 * @prop major - the "major" version
 * @prop minor - the "minor" version
 * @prop patch - the "patch" (or "micro") version
 */
// Note that this is currently compatible with SemVer objects,
// but we may change it to match the format of sys.version_info.
export type PythonVersion = {
    raw: string;
    major: number;
    minor: number;
    patch: number;
};
