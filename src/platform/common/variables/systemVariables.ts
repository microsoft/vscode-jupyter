// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import * as Types from '../utils/sysTypes';
import { IStringDictionary, ISystemVariables } from './types';

/* eslint-disable , @typescript-eslint/no-explicit-any, , jsdoc/check-alignment,jsdoc/check-indentation,jsdoc/newline-after-description, no-restricted-syntax, prefer-const,  */

/**
 * Resolves vscode style environment variables in a string. Example ${workspaceRoot}
 */
export abstract class AbstractSystemVariables implements ISystemVariables {
    public resolve(value: string): string;
    public resolve(value: string[]): string[];
    public resolve(value: IStringDictionary<string>): IStringDictionary<string>;
    public resolve(value: IStringDictionary<string[]>): IStringDictionary<string[]>;
    public resolve(value: IStringDictionary<IStringDictionary<string>>): IStringDictionary<IStringDictionary<string>>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public resolve(value: any): any {
        if (Types.isString(value)) {
            return this.__resolveString(value);
        } else if (Types.isArray(value)) {
            return this.__resolveArray(value);
        } else if (Types.isObject(value)) {
            return this.__resolveLiteral(value);
        }

        return value;
    }

    public resolveAny<T>(value: T): T;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public resolveAny(value: any): any {
        if (Types.isString(value)) {
            return this.__resolveString(value);
        } else if (Types.isArray(value)) {
            return this.__resolveAnyArray(value);
        } else if (Types.isObject(value)) {
            return this.__resolveAnyLiteral(value);
        }

        return value;
    }

    private __resolveString(value: string): string {
        const regexp = /\$\{(.*?)\}/g;
        return value.replace(regexp, (match: string, name: string) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const newValue = (<any>this)[name];
            if (Types.isString(newValue)) {
                return newValue;
            } else {
                return match && (match.indexOf('env.') > 0 || match.indexOf('env:') > 0) ? '' : match;
            }
        });
    }

    private __resolveLiteral(
        values: IStringDictionary<string | IStringDictionary<string> | string[]>
    ): IStringDictionary<string | IStringDictionary<string> | string[]> {
        const result: IStringDictionary<string | IStringDictionary<string> | string[]> = Object.create(null);
        Object.keys(values).forEach((key) => {
            const value = values[key];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            result[key] = <any>this.resolve(<any>value);
        });
        return result;
    }

    private __resolveAnyLiteral<T>(values: T): T;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private __resolveAnyLiteral(values: any): any {
        const result: IStringDictionary<string | IStringDictionary<string> | string[]> = Object.create(null);
        Object.keys(values).forEach((key) => {
            const value = values[key];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            result[key] = <any>this.resolveAny(<any>value);
        });
        return result;
    }

    private __resolveArray(value: string[]): string[] {
        return value.map((s) => this.__resolveString(s));
    }

    private __resolveAnyArray<T>(value: T[]): T[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private __resolveAnyArray(value: any[]): any[] {
        return value.map((s) => this.resolveAny(s));
    }
}
