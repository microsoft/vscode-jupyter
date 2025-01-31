// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Dummy global process variable for use in webviews, such as IPyWidgets kernel and renderers
// We cannot use the esbuild CLI to inject these, because some code checks for the existence of process.env.XYZ
// And its not possible in CLI to have an undefined define value for these.
export var process = {
    platform: 'web',
    cwd: () => '',
    env: {
        NODE_ENV: 'production'
    }
};
