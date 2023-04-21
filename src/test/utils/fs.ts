// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as tmp from 'tmp';

export function createTemporaryFile(
    extension: string,
    temporaryDirectory?: string
): Promise<{ filePath: string; cleanupCallback: Function }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: any = { postfix: extension };
    if (temporaryDirectory) {
        options.dir = temporaryDirectory;
    }

    return new Promise<{ filePath: string; cleanupCallback: Function }>((resolve, reject) => {
        tmp.file(options, (err, tmpFile, _fd, cleanupCallback) => {
            if (err) {
                return reject(err);
            }
            resolve({ filePath: tmpFile, cleanupCallback: cleanupCallback });
        });
    });
}
