// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Serialize ArrayBuffer and ArrayBufferView into a format such that they are json serializable.
 *
 * @export
 * @param {(undefined | (ArrayBuffer | ArrayBufferView)[])} buffers
 * @returns
 */
export function serializeDataViews(buffers: undefined | (ArrayBuffer | ArrayBufferView)[]) {
    if (!buffers || !Array.isArray(buffers) || buffers.length === 0) {
        return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newBufferView: any[] = [];
    // eslint-disable-next-line @typescript-eslint/prefer-for-of
    for (let i = 0; i < buffers.length; i += 1) {
        const item = buffers[i];
        if ('buffer' in item && 'byteOffset' in item) {
            // It is an ArrayBufferView
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const buffer = Array.apply(null, new Uint8Array(item.buffer as any) as any);
            newBufferView.push({
                ...item,
                byteLength: item.byteLength,
                byteOffset: item.byteOffset,
                buffer
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);
        } else {
            // Do not use `Array.apply`, it will not work for large arrays.
            // Nodejs will throw `stackoverflow` exceptions.
            // Else following ipynb fails https://github.com/K3D-tools/K3D-jupyter/blob/821a59ed88579afaafababd6291e8692d70eb088/examples/camera_manipulation.ipynb
            // Yet another case where 99% can work, but 1% can fail when testing.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            newBufferView.push([...new Uint8Array(item as any)]);
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return newBufferView;
}

/**
 * Deserializes ArrayBuffer and ArrayBufferView from a format that was json serializable into actual ArrayBuffer and ArrayBufferViews.
 *
 * @export
 * @param {(undefined | (ArrayBuffer | ArrayBufferView)[])} buffers
 * @returns
 */
export function deserializeDataViews(buffers: undefined | (ArrayBuffer | ArrayBufferView)[]) {
    if (!Array.isArray(buffers) || buffers.length === 0) {
        return buffers;
    }
    const newBufferView: (ArrayBuffer | ArrayBufferView)[] = [];
    // eslint-disable-next-line @typescript-eslint/prefer-for-of
    for (let i = 0; i < buffers.length; i += 1) {
        const item = buffers[i];
        if ('buffer' in item && 'byteOffset' in item) {
            const buffer = new Uint8Array(item.buffer).buffer;
            // It is an ArrayBufferView
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const bufferView = new DataView(buffer, item.byteOffset, item.byteLength);
            newBufferView.push(bufferView);
        } else {
            const buffer = new Uint8Array(item).buffer;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            newBufferView.push(buffer);
        }
    }
    return newBufferView;
}
