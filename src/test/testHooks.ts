import { Context } from 'mocha';
import { Telemetry } from '../platform/common/constants';
import { sleep } from '../platform/common/utils/async';
import { clearTelemetryReporter, sendTelemetryEvent } from '../telemetry';
import { IS_CI_SERVER } from './ciConstants.node';
import { overrideTelemetrySettingForCi, undoTelemetrySettingOverride } from './utils/ciTelemetry.node';

export const rootHooks = {
    beforeAll() {
        if (!IS_CI_SERVER) {
            return;
        }

        overrideTelemetrySettingForCi();
    },
    afterEach(this: Context) {
        if (!IS_CI_SERVER) {
            return;
        }

        let result = this.currentTest?.isFailed() ? 'failed' : this.currentTest?.isPassed() ? 'passed' : 'skipped';
        if (this.currentTest?.title) {
            sendTelemetryEvent(Telemetry.RunTest, this.currentTest?.duration, {
                testName: this.currentTest?.title,
                testResult: result
            });
        }
    },
    afterAll: async function () {
        if (!IS_CI_SERVER) {
            return;
        }

        await clearTelemetryReporter();
        await sleep(5000);
        undoTelemetrySettingOverride();
    }
};
