import { Context } from 'mocha';
import { Telemetry } from '../platform/common/constants';
import { sendTelemetryEvent } from '../telemetry';
import { IS_CI_SERVER } from './ciConstants.node';

export const rootHooks = {
    afterEach(this: Context) {
        let result = this.currentTest?.isFailed() ? 'failed' : this.currentTest?.isPassed() ? 'passed' : 'skipped';
        if (this.currentTest?.title) {
            sendTelemetryEvent(Telemetry.RunTest, this.currentTest?.duration, {
                testName: this.currentTest?.title,
                testResult: result,
                isCIServer: IS_CI_SERVER
            });
        }
    }
};
