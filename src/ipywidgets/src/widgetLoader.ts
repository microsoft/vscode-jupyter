// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// tslint:disable-next-line: no-any
async function requirePromise(pkg: string | string[]): Promise<any> {
    return new Promise((resolve, reject) => {
        // tslint:disable-next-line: no-console
        console.log('require promise');
        // tslint:disable-next-line: no-any
        const requirejsfunc = (window as any).requirejs || requirejs;
        if (requirejsfunc === undefined) {
            reject('Requirejs is needed, please ensure it is loaded on the page.');
        } else {
            requirejsfunc(pkg, resolve, reject);
        }
    });
}
export function requireLoader(moduleName: string) {
    return requirePromise([`${moduleName}`]);
}
