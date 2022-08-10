// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CharCode } from './charCode';
import { posix, sep } from './path';
import { startsWithIgnoreCase } from './strings';

export function isPathSeparator(code: number) {
    return code === CharCode.Slash || code === CharCode.Backslash;
}

/**
 * Takes a Windows OS path and changes backward slashes to forward slashes.
 * This should only be done for OS paths from Windows (or user provided paths potentially from Windows).
 * Using it on a Linux or MaxOS path might change it.
 */
export function toSlashes(osPath: string) {
    return osPath.replace(/[\\/]/g, posix.sep);
}

/**
 * Takes a Windows OS path (using backward or forward slashes) and turns it into a posix path:
 * - turns backward slashes into forward slashes
 * - makes it absolute if it starts with a drive letter
 * This should only be done for OS paths from Windows (or user provided paths potentially from Windows).
 * Using it on a Linux or MaxOS path might change it.
 */
export function toPosixPath(osPath: string) {
    if (osPath.indexOf('/') === -1) {
        osPath = toSlashes(osPath);
    }
    if (/^[a-zA-Z]:(\/|$)/.test(osPath)) {
        // starts with a drive letter
        osPath = '/' + osPath;
    }
    return osPath;
}

/**
 * Computes the _root_ this path, like `getRoot('c:\files') === c:\`,
 * `getRoot('files:///files/path') === files:///`,
 * or `getRoot('\\server\shares\path') === \\server\shares\`
 */
export function getRoot(path: string, sep: string = posix.sep): string {
    if (!path) {
        return '';
    }

    const len = path.length;
    const firstLetter = path.charCodeAt(0);
    if (isPathSeparator(firstLetter)) {
        if (isPathSeparator(path.charCodeAt(1))) {
            // UNC candidate \\localhost\shares\ddd
            //               ^^^^^^^^^^^^^^^^^^^
            if (!isPathSeparator(path.charCodeAt(2))) {
                let pos = 3;
                const start = pos;
                for (; pos < len; pos++) {
                    if (isPathSeparator(path.charCodeAt(pos))) {
                        break;
                    }
                }
                if (start !== pos && !isPathSeparator(path.charCodeAt(pos + 1))) {
                    pos += 1;
                    for (; pos < len; pos++) {
                        if (isPathSeparator(path.charCodeAt(pos))) {
                            return path
                                .slice(0, pos + 1) // consume this separator
                                .replace(/[\\/]/g, sep);
                        }
                    }
                }
            }
        }

        // /user/far
        // ^
        return sep;
    } else if (isWindowsDriveLetter(firstLetter)) {
        // check for windows drive letter c:\ or c:

        if (path.charCodeAt(1) === CharCode.Colon) {
            if (isPathSeparator(path.charCodeAt(2))) {
                // C:\fff
                // ^^^
                return path.slice(0, 2) + sep;
            } else {
                // C:
                // ^^
                return path.slice(0, 2);
            }
        }
    }

    // check for URI
    // scheme://authority/path
    // ^^^^^^^^^^^^^^^^^^^
    let pos = path.indexOf('://');
    if (pos !== -1) {
        pos += 3; // 3 -> "://".length
        for (; pos < len; pos++) {
            if (isPathSeparator(path.charCodeAt(pos))) {
                return path.slice(0, pos + 1); // consume this separator
            }
        }
    }

    return '';
}

/**
 * @deprecated please use `IUriIdentityService.extUri.isEqualOrParent` instead. If
 * you are in a context without services, consider to pass down the `extUri` from the
 * outside, or use `extUriBiasedIgnorePathCase` if you know what you are doing.
 */
export function isEqualOrParent(base: string, parentCandidate: string, ignoreCase?: boolean, separator = sep): boolean {
    if (base === parentCandidate) {
        return true;
    }

    if (!base || !parentCandidate) {
        return false;
    }

    if (parentCandidate.length > base.length) {
        return false;
    }

    if (ignoreCase) {
        const beginsWith = startsWithIgnoreCase(base, parentCandidate);
        if (!beginsWith) {
            return false;
        }

        if (parentCandidate.length === base.length) {
            return true; // same path, different casing
        }

        let sepOffset = parentCandidate.length;
        if (parentCandidate.charAt(parentCandidate.length - 1) === separator) {
            sepOffset--; // adjust the expected sep offset in case our candidate already ends in separator character
        }

        return base.charAt(sepOffset) === separator;
    }

    if (parentCandidate.charAt(parentCandidate.length - 1) !== separator) {
        parentCandidate += separator;
    }

    return base.indexOf(parentCandidate) === 0;
}

export function isWindowsDriveLetter(char0: number): boolean {
    return (char0 >= CharCode.A && char0 <= CharCode.Z) || (char0 >= CharCode.a && char0 <= CharCode.z);
}
