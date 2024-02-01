// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Environment } from '@vscode/python-extension';
import { computeHash } from '../common/crypto';
import { traceError } from '../logging';

export function getTelemetrySafeVersion(version: string | Environment['version']): string {
    if (typeof version === 'string') {
        try {
            // Split by `.` & take only the first 3 numbers.
            // Suffix with '.', so we know we'll always have 3 items in the array.
            const [major, minor, patch] = `${version.trim()}...`.split('.').map((item) => parseInt(item, 10));
            if (isNaN(major)) {
                return '';
            } else if (isNaN(minor)) {
                return major.toString();
            } else if (isNaN(patch)) {
                return `${major}.${minor}`;
            }
            return `${major}.${minor}.${patch}`;
        } catch (ex) {
            traceError(`Failed to parse version ${version}`, ex);
            return '';
        }
    }
    if (!version) {
        return '';
    }

    return `${version.major}.${version.minor}.${version.micro}`;
}

/**
 * Safe way to send data in telemetry (obfuscate PII).
 */
export async function getTelemetrySafeHashedString(data: string) {
    return computeHash(data, 'SHA-256');
}
