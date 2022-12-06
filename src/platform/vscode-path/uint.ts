// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export const enum Constants {
    /**
     * MAX SMI (SMall Integer) as defined in v8.
     * one bit is lost for boxing/unboxing flag.
     * one bit is lost for sign flag.
     * See https://thibaultlaurens.github.io/javascript/2013/04/29/how-the-v8-engine-works/#tagged-values
     */
    MAX_SAFE_SMALL_INTEGER = 1 << 30,

    /**
     * MIN SMI (SMall Integer) as defined in v8.
     * one bit is lost for boxing/unboxing flag.
     * one bit is lost for sign flag.
     * See https://thibaultlaurens.github.io/javascript/2013/04/29/how-the-v8-engine-works/#tagged-values
     */
    MIN_SAFE_SMALL_INTEGER = -(1 << 30),

    /**
     * Max unsigned integer that fits on 8 bits.
     */
    MAX_UINT_8 = 255, // 2^8 - 1

    /**
     * Max unsigned integer that fits on 16 bits.
     */
    MAX_UINT_16 = 65535, // 2^16 - 1

    /**
     * Max unsigned integer that fits on 32 bits.
     */
    MAX_UINT_32 = 4294967295, // 2^32 - 1

    UNICODE_SUPPLEMENTARY_PLANE_BEGIN = 0x010000
}
