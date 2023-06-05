// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const hasPerformanceNow = globalThis.performance && typeof globalThis.performance.now === 'function';

export class StopWatch {
    private _highResolution: boolean;
    private _startTime: number;
    private _stopTime: number;

    public static create(highResolution: boolean = true): StopWatch {
        return new StopWatch(highResolution);
    }

    constructor(highResolution: boolean = false) {
        this._highResolution = hasPerformanceNow && highResolution;
        this._startTime = this._now();
        this._stopTime = -1;
    }

    public stop(): void {
        this._stopTime = this._now();
    }

    public reset(): void {
        this._startTime = this._now();
        this._stopTime = -1;
    }

    public elapsed(): number {
        if (this._stopTime !== -1) {
            return this._stopTime - this._startTime;
        }
        return this._now() - this._startTime;
    }

    public get elapsedTime(): number {
        return this.elapsed();
    }

    private _now(): number {
        return this._highResolution ? globalThis.performance.now() : Date.now();
    }
}
