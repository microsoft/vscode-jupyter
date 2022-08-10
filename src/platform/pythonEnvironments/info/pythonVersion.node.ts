// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Eventually we will want to also support the release serial
// (e.g. beta1, candidate3) and maybe even release abbreviations

import { SemVer } from 'semver';
import { PythonVersion } from './pythonVersion';

// (e.g. 3.9.2b1, 3.8.10rc3).
export function parsePythonVersion(raw: string): PythonVersion | undefined {
    if (!raw || raw.trim().length === 0) {
        return;
    }
    const versionParts = (raw || '')
        .split('.')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .filter((_, index) => index < 4);

    if (versionParts.length > 0 && versionParts[versionParts.length - 1].indexOf('-') > 0) {
        const lastPart = versionParts[versionParts.length - 1];
        versionParts[versionParts.length - 1] = lastPart.split('-')[0].trim();
        versionParts.push(lastPart.split('-')[1].trim());
    }
    while (versionParts.length < 4) {
        versionParts.push('');
    }
    // Exclude PII from `version_info` to ensure we don't send this up via telemetry.
    for (let index = 0; index < 3; index += 1) {
        versionParts[index] = /^\d+$/.test(versionParts[index]) ? versionParts[index] : '0';
    }
    if (['alpha', 'beta', 'candidate', 'final'].indexOf(versionParts[3]) === -1) {
        versionParts.pop();
    }
    const numberParts = `${versionParts[0]}.${versionParts[1]}.${versionParts[2]}`;
    const rawVersion = versionParts.length === 4 ? `${numberParts}-${versionParts[3]}` : numberParts;
    return new SemVer(rawVersion);
}
