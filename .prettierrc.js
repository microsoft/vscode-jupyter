// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

module.exports = {
    singleQuote: true,
    printWidth: 120,
    tabWidth: 4,
    endOfLine: 'auto',
    trailingComma: 'none',
    overrides: [
        {
            files: ['*.yml', '*.yaml'],
            options: {
                tabWidth: 2
            }
        },
        {
            files: ['**/datascience/serviceRegistry.ts'],
            options: {
                printWidth: 240
            }
        }
    ]
};
