// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
export const sliceRegEx = /^\s*((?<StartRange>-?\d+:)|(?<StopRange>-?:\d+)|(?:(?<Start>-?\d+)(?::(?<Stop>-?\d+))?(?::(?<Step>-?\d+))?))\s*$/;

/**
 *
 * @returns A Python slice expression with the 0th index preselected along
 * the first ndim - 2 axes. For example, for a 5D array with shape
 * (10, 20, 30, 40, 50), the preselected slice expression is [0, 0, 0, :, :].
 */
export function preselectedSliceExpression(shape: number[]) {
    let numDimensionsToPreselect = shape.length - 2;
    return (
        '[' +
        shape
            .map(() => {
                if (numDimensionsToPreselect > 0) {
                    numDimensionsToPreselect -= 1;
                    return '0';
                }
                return ':';
            })
            .join(', ') +
        ']'
    );
}

export function fullSliceExpression(shape: number[]) {
    return '[' + shape.map(() => ':').join(', ') + ']';
}

export function validateSliceExpression(sliceExpression: string, shape: number[]) {
    if (sliceExpression.startsWith('[') && sliceExpression.endsWith(']')) {
        let hasOutOfRangeIndex: { shapeIndex: number; value: number } | undefined;
        const parsedExpression = sliceExpression
            .substring(1, sliceExpression.length - 1)
            .split(',')
            .map((shapeEl, shapeIndex) => {
                // Validate IndexErrors
                const match = sliceRegEx.exec(shapeEl);
                if (match?.groups?.Start && !match.groups.Stop) {
                    const value = parseInt(match.groups.Start);
                    const numberOfElementsAlongAxis = shape[shapeIndex];
                    if (
                        (value >= 0 && value >= numberOfElementsAlongAxis) ||
                        // Python allows negative index values
                        (value < 0 && value < -numberOfElementsAlongAxis)
                    ) {
                        hasOutOfRangeIndex = { shapeIndex, value };
                    }
                    return value;
                }
            });

        if (hasOutOfRangeIndex) {
            const { shapeIndex, value } = hasOutOfRangeIndex;
            return `IndexError at axis ${shapeIndex}, index ${value}`;
        } else if (parsedExpression && parsedExpression.length !== shape.length) {
            return 'Invalid slice expression';
        }
    }
    return '';
}

export function isValidSliceExpression(sliceExpression: string, shape: number[]) {
    return validateSliceExpression(sliceExpression, shape) === '';
}
