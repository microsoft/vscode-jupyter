// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// https://github.com/microsoft/vscode-python/issues/13155
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sortObjectPropertiesRecursively(obj: any): any {
    if (Array.isArray(obj)) {
        return obj.map(sortObjectPropertiesRecursively);
    }
    if (obj !== undefined && obj !== null && typeof obj === 'object' && Object.keys(obj).length > 0) {
        return (
            Object.keys(obj)
                .sort()
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .reduce<Record<string, any>>((sortedObj, prop) => {
                    sortedObj[prop] = sortObjectPropertiesRecursively(obj[prop]);
                    return sortedObj;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                }, {}) as any
        );
    }
    return obj;
}
