// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function runMountedTest(name: string, testFunc: (this: Mocha.Context, context: Mocha.Context) => Promise<void>) {
    test(name, async function () {
        // eslint-disable-next-line no-invalid-this
        await testFunc.bind(this)(this);
    });
}
