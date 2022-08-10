// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * @returns whether the provided parameter is a JavaScript String or not.
 */
export function isString(str: unknown): str is string {
    return typeof str === 'string';
}

/**
 * In **contrast** to just checking `typeof` this will return `false` for `NaN`.
 * @returns whether the provided parameter is a JavaScript Number or not.
 */
export function isNumber(obj: unknown): obj is number {
    return typeof obj === 'number' && !isNaN(obj);
}

/**
 * @returns whether the provided parameter is undefined.
 */
export function isUndefined(obj: unknown): obj is undefined {
    return typeof obj === 'undefined';
}

/**
 * @returns whether the provided parameter is undefined or null.
 */
export function isUndefinedOrNull(obj: unknown): obj is undefined | null {
    return isUndefined(obj) || obj === null;
}

/**
 * @returns whether the provided parameter is a JavaScript Function or not.
 */
export function isFunction(obj: unknown): obj is Function {
    return typeof obj === 'function';
}

export type TypeConstraint = string | Function;

export function validateConstraint(arg: unknown, constraint: TypeConstraint | undefined): void {
    if (isString(constraint)) {
        if (typeof arg !== constraint) {
            throw new Error(`argument does not match constraint: typeof ${constraint}`);
        }
    } else if (isFunction(constraint)) {
        try {
            if (arg instanceof constraint) {
                return;
            }
        } catch {
            // ignore
        }
        if (!isUndefinedOrNull(arg) && (arg as any).constructor === constraint) {
            return;
        }
        if (constraint.length === 1 && constraint.call(undefined, arg) === true) {
            return;
        }
        throw new Error(
            `argument does not match one of these constraints: arg instanceof constraint, arg.constructor === constraint, nor constraint(arg) === true`
        );
    }
}
