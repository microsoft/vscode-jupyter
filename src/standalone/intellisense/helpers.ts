// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function generateSortString(index: number) {
    // If its 0, then use AA, if 25, then use ZZ
    // This will give us the ability to sort first 700 items (thats more than enough).
    // To keep things fast we'll only sort the first 300.
    if (index >= 300) {
        return 'ZZZZZZZ';
    }
    if (index <= 25) {
        return `A${String.fromCharCode(65 + index)}`;
    }
    const firstChar = String.fromCharCode(65 + Math.ceil(index / 25));
    const secondChar = String.fromCharCode(65 + (index % 25));
    return `${firstChar}${secondChar}`;
}
