// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// This file has been handcrafted to override the use of moment.js.
// Moment is only used in @jupyterlab/coreutils/lib/time.js
// & that code is not used anywhere in any code path.
// Hence we create a dummy moment object that does nothing.
// & we have checks on CI that ensures no other npm package or other code does not in-directly or directly use moment.

export default function (dateTime) {
    return {
        formatNow: () => {
            try {
                return dateTime.toLocaleString();
            } catch {
                return `${dateTime}`;
            }
        },
        format: () => {
            try {
                return dateTime.toLocaleTimeString();
            } catch {
                return `${dateTime}`;
            }
        }
    };
}
