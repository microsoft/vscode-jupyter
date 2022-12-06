// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import TelemetryReporter from '@vscode/extension-telemetry';
import { StopWatch } from '../../platform/common/utils/stopWatch';

declare module 'mocha' {
    export interface Test {
        perfCheckpoints: Record<string, number>;
    }
}

export class PerformanceTracker {
    stopWatch = new StopWatch();
    checkpoints: Record<string, number> = {};
    checkpointCount = 0;
    telemetryReporter: TelemetryReporter | undefined;

    public startTime() {
        this.stopWatch.reset();
    }

    public markTime(label: string) {
        this.checkpoints[`${this.checkpointCount++}_${label}`] = this.stopWatch.elapsedTime;
    }

    public finish(): Record<string, number> {
        this.checkpoints.totalTime = this.stopWatch.elapsedTime;
        console.log(`test completed with checkpoints: ${JSON.stringify(this.checkpoints)}`);
        return this.checkpoints;
    }
}
