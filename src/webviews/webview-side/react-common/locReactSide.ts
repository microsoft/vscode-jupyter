// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { LocalizedMessages } from '../../../messageTypes';

// The react code can't use the localize.ts module because it reads from
// disk. This isn't allowed inside a browser, so we pass the collection
// through the javascript.
let loadedCollection: LocalizedMessages | undefined;

export function getLocString(key: keyof LocalizedMessages, defValue: string): string {
    if (loadedCollection && loadedCollection.hasOwnProperty(key)) {
        return loadedCollection[key];
    }

    return defValue;
}

export function storeLocStrings(collection: LocalizedMessages) {
    loadedCollection = collection;
}

export function format(locString: string, ...args: string[]) {
    return locString.replace(/{(\d+)}/g, (match, number) => (args[number] === undefined ? match : args[number]));
}
