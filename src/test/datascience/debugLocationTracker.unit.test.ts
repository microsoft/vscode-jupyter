// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable , , @typescript-eslint/no-explicit-any, no-multi-str, no-trailing-spaces */
import { expect } from 'chai';
import { DebugProtocol } from 'vscode-debugprotocol';
import { DebugLocationTracker } from '../../notebooks/debugger/debugLocationTracker';
import { IDebugLocation } from '../../notebooks/debugger/debuggingTypes';

suite('Debug Location Tracker', () => {
    let debugTracker: DebugLocationTracker;

    setup(() => {
        debugTracker = new DebugLocationTracker('1');
    });

    test('Check debug location', async () => {
        expect(debugTracker.debugLocation).to.be.equal(undefined, 'Initial location is empty');

        debugTracker.onDidSendMessage(makeStopMessage());

        expect(debugTracker.debugLocation).to.be.equal(undefined, 'After stop location is empty');

        debugTracker.onWillReceiveMessage(makeStackTraceRequest());
        debugTracker.onDidSendMessage(makeStackTraceMessage());

        const testLocation: IDebugLocation = { lineNumber: 1, column: 1, fileName: 'testpath' };
        expect(debugTracker.debugLocation).to.be.deep.equal(testLocation, 'Source location is incorrect');

        debugTracker.onDidSendMessage(makeContinueMessage());

        expect(debugTracker.debugLocation).to.be.equal(undefined, 'After continue location is empty');
    });
});

function makeStopMessage(): any {
    return { type: 'event', event: 'stopped' };
}

function makeContinueMessage(): any {
    return { type: 'event', event: 'continue' };
}

function makeStackTraceMessage(): DebugProtocol.Response {
    return {
        type: 'response',
        command: 'stackTrace',
        request_seq: 42,
        success: true,
        seq: 43,
        body: {
            stackFrames: [{ id: 9000, line: 1, column: 1, source: { path: 'testpath' } }]
        }
    };
}

function makeStackTraceRequest(): DebugProtocol.Request {
    return {
        type: 'request',
        command: 'stackTrace',
        seq: 42,
        arguments: {
            levels: 1,
            startFrame: 0,
            threadId: 1
        }
    };
}
