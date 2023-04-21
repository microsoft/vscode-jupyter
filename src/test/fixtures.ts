// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from 'fs-extra';

export type CleanupFunc = (() => void) | (() => Promise<void>);

export class CleanupFixture {
    private cleanups: CleanupFunc[];
    constructor() {
        this.cleanups = [];
    }

    public addCleanup(cleanup: CleanupFunc) {
        this.cleanups.push(cleanup);
    }
    public addFSCleanup(filename: string) {
        this.addCleanup(async () => {
            try {
                await fs.unlink(filename);
            } catch {
                // The file is already gone.
            }
        });
    }

    public async cleanUp() {
        const cleanups = this.cleanups;
        this.cleanups = [];

        return Promise.all(
            cleanups.map(async (cleanup, i) => {
                try {
                    const res = cleanup();
                    if (res) {
                        await res;
                    }
                } catch (err) {
                    // eslint-disable-next-line no-console
                    console.error(`cleanup ${i + 1} failed: ${err}`);
                    // eslint-disable-next-line no-console
                    console.error('moving on...');
                }
            })
        );
    }
}
