// Crypto from lib.d.ts
declare module 'msrCrypto' {
    var msrCrypto: Crypto;
    export = msrCrypto;
}

// Extend default Crypto from lib.d.ts to add msrCrypto extras
interface Crypto {
    initPrng(entropyData: ArrayLike<number>): void;
    toBase64(data: ArrayLike<number> | ArrayBuffer, toBase64Url?: boolean): string;
    fromBase64(data: string): ArrayLike<number>;
    textToBytes(text: string): ArrayLike<number>;
    bytesToText(bytes: ArrayLike<number>): String;
}

// Extend default Algorithm from lib.d.ts
//interface Algorithm {
//    salt?: ArrayLike<number>,
//    namedCurve?: string,
//    iv?: ArrayLike<number>,
//    tagLength?: number,
//    additionalData?: ArrayLike<number>,
//    hash?: { name: string },
//    length?: number,
//    stream?: boolean
//}

// Support msrCrypto streaming with new StreamObject
interface StreamObject {
    process(data: ArrayBuffer | ArrayLike<number>): PromiseLike<ArrayBuffer | ArrayLike<number> | void>;
    finish(): PromiseLike<ArrayBuffer | ArrayLike<number>>;
    abort(): PromiseLike<void>;
}
