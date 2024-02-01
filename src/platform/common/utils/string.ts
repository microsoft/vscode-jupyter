// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function base64ToUint8Array(base64: string): Uint8Array {
    if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
        return Buffer.from(base64, 'base64');
    } else {
        return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    }
}

const textDecoder = new TextDecoder();
export function uint8ArrayToBase64(buffer: Uint8Array): string {
    if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
        return Buffer.from(buffer).toString('base64');
    } else {
        // https://developer.mozilla.org/en-US/docs/Glossary/Base64#solution_1_%E2%80%93_escaping_the_string_before_encoding_it
        const stringValue = textDecoder.decode(buffer);
        return btoa(
            encodeURIComponent(stringValue).replace(/%([0-9A-F]{2})/g, function (_match, p1) {
                return String.fromCharCode(Number.parseInt('0x' + p1));
            })
        );
    }
}
