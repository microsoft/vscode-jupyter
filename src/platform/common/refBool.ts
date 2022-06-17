// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

export class RefBool {
    constructor(private val: boolean) {}

    public get value(): boolean {
        return this.val;
    }

    public update(newVal: boolean) {
        this.val = newVal;
    }
}
