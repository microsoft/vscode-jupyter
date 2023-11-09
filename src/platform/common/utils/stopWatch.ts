// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tracks wall clock time. Start time is set at contruction.
 */
export class StopWatch {
    private started = Date.now();
    public get elapsedTime() {
        return Date.now() - this.started;
    }
    public reset() {
        this.started = Date.now();
    }
}
