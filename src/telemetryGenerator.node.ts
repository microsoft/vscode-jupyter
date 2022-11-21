// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// This line should always be right on top.
/* eslint-disable @typescript-eslint/no-explicit-any */
if ((Reflect as any).metadata === undefined) {
    require('reflect-metadata');
}
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as ts from 'typescript';
import * as fs from 'fs-extra';
import glob from 'glob';
import { initialize } from './test/vscode-mock';
import { Parser } from 'json2csv';
import colors from 'colors';
// eslint-disable-next-line local-rules/node-imports
import * as path from 'path';

initialize();

import {
    IEventData,
    IEventNamePropertyMapping,
    CommonProperties,
    IPropertyDataNonMeasurement,
    IPropertyDataMeasurement,
    TelemetryEventInfo,
    CommonPropertyAndMeasureTypeNames
} from './telemetry';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from './test/constants.node';
const GDPRData = new IEventNamePropertyMapping();
let gdprEntryOfCurrentlyComputingTelemetryEventName: [name: string, gdpr: TelemetryEventInfo<unknown>] | undefined;
const errorsByOwners: Record<string, Record<string, EventProblem>> = {};

/**
 * A TypeScript language service host
 */
class TypeScriptLanguageServiceHost implements ts.LanguageServiceHost {
    private readonly _files: string[];
    private readonly _compilerOptions: ts.CompilerOptions;

    constructor(files: string[], compilerOptions: ts.CompilerOptions) {
        this._files = files;
        this._compilerOptions = compilerOptions;
    }
    readFile(path: string, encoding?: string | undefined): string | undefined {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return fs.readFileSync(path, { encoding } as any).toString();
    }
    fileExists(path: string): boolean {
        return fs.existsSync(path);
    }

    // --- language service host ---------------

    getCompilationSettings(): ts.CompilerOptions {
        return this._compilerOptions;
    }
    getScriptFileNames(): string[] {
        return this._files;
    }
    getScriptVersion(_fileName: string): string {
        return '1';
    }
    getProjectVersion(): string {
        return '1';
    }
    getScriptSnapshot(fileName: string): ts.IScriptSnapshot {
        if (this._files.includes(fileName)) {
            return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName).toString());
        } else {
            return ts.ScriptSnapshot.fromString('');
        }
    }
    getScriptKind(_fileName: string): ts.ScriptKind {
        return ts.ScriptKind.TS;
    }
    getCurrentDirectory(): string {
        return '';
    }
    getDefaultLibFileName(_options: ts.CompilerOptions): string {
        return 'defaultLib:lib.d.ts';
    }
    isDefaultLibFileName(fileName: string): boolean {
        return fileName === this.getDefaultLibFileName(this._compilerOptions);
    }
}

function findNode(sourceFile: ts.SourceFile, position: number, length?: number): ts.Node | undefined {
    let found: ts.Node | undefined;
    let lastFoundNode: ts.Node | undefined;
    sourceFile.forEachChild(visit);

    function visit(node: ts.Node) {
        if (node.pos === position) {
            found = node;
            return;
        } else if (node.pos > position) {
            return;
        } else if (length && node.pos < position && node.end >= position + length) {
            lastFoundNode = node;
        }
        ts.forEachChild(node, visit);
    }
    return found || lastFoundNode;
}

type TelemetryProperty = {
    name: string;
    descriptions: string[] | string;
    type?: string;
    possibleValues?: { value: string; comment?: string | string[] }[];
    isNullable?: boolean;
    gdpr: IPropertyDataNonMeasurement | IPropertyDataMeasurement;
};

type TelemetryPropertyGroup = {
    description?: string[];
    properties: TelemetryProperty[];
};
type TelemetryEntry = {
    name: string;
    constantName: string;
    description: string;
    gdpr: IEventData;
    propertyGroups: TelemetryPropertyGroup[];
};

function writeOutput(line: string) {
    fs.appendFileSync(`./TELEMETRY.md`, `${line}\n`);
}

function computePropertiesForLiteralType(literalType: ts.TypeLiteralNode, typeChecker: ts.TypeChecker) {
    const properties: TelemetryProperty[] = [];

    literalType.members.forEach((m) => {
        if (m.kind === ts.SyntaxKind.PropertySignature && ts.isPropertySignature(m)) {
            const name = m.name.getText();
            const anyM = m as unknown as { jsDoc?: { comment: string }[] };
            const descriptions = Array.isArray(anyM.jsDoc) ? anyM.jsDoc[0].comment.split(/\r?\n/) || [] : [];
            let possibleValues: { value: string; comment?: string | string[] }[] = [];
            let typeValue = '';
            if (
                (m.type?.kind === ts.SyntaxKind.TypeReference && ts.isTypeReferenceNode(m.type)) ||
                (m.type?.kind === ts.SyntaxKind.UnionType && ts.isUnionTypeNode(m.type))
            ) {
                const type = typeChecker.getTypeAtLocation(m.type);
                if (type.isUnion()) {
                    const isEnum = type
                        .getSymbol()
                        ?.getDeclarations()
                        ?.some((d) => d.kind === ts.SyntaxKind.EnumDeclaration);
                    const enumName = type.getSymbol()?.escapedName;
                    type.types.forEach((t) => {
                        if (t.isLiteral()) {
                            const value = t.value.toString();
                            const declaration = t.symbol?.declarations?.length
                                ? (t.symbol.declarations[0] as unknown as { jsDoc?: { comment: string }[] })
                                : undefined;
                            const comment = [];
                            if (isEnum && parseInt(value, 10).toString() === value.trim()) {
                                comment.push(`Enum Member: ${enumName}.${t.symbol.escapedName}`);
                            }
                            if (declaration && Array.isArray(declaration.jsDoc) && declaration.jsDoc.length > 0) {
                                comment.push(declaration.jsDoc[0].comment);
                            }
                            possibleValues.push({ value, comment });
                        }
                    });
                }
                const mType = m.type;
                if (
                    mType.kind === ts.SyntaxKind.UnionType &&
                    ts.isUnionTypeNode(mType) &&
                    possibleValues.every((item) => (item.comment || '').length === 0)
                ) {
                    // Support comments in union string literals.
                    const newPossibleValues: { value: string; comment?: string | string[] }[] = [];
                    mType.types.forEach((t) => {
                        if (t.kind === ts.SyntaxKind.LiteralType) {
                            const value = t.getText();
                            const comment = getCommentForUnions(t);
                            newPossibleValues.push({ value, comment });
                        } else if (t.kind === ts.SyntaxKind.NullKeyword || t.kind === ts.SyntaxKind.UndefinedKeyword) {
                            newPossibleValues.push({ value: 'null or <empty>', comment: '' });
                        } else if (t.kind === ts.SyntaxKind.BooleanKeyword) {
                            newPossibleValues.push({ value: 'true', comment: '' });
                            newPossibleValues.push({ value: 'false', comment: '' });
                        }
                    });
                    if (
                        possibleValues.length === 0 ||
                        (newPossibleValues.length === possibleValues.length &&
                            [...newPossibleValues].sort().join('') === [...possibleValues].sort().join(''))
                    ) {
                        possibleValues = newPossibleValues;
                    }
                }
            } else {
                typeValue = m.type?.getText() ? m.type?.getText() : '';
            }
            const isNullable =
                m.getChildren().some((c) => c.kind === ts.SyntaxKind.QuestionToken) ||
                typeValue.includes(' | undefined') ||
                typeValue.includes('undefined | ');

            let gdprEntry: undefined | IPropertyDataMeasurement | IPropertyDataNonMeasurement;
            if (gdprEntryOfCurrentlyComputingTelemetryEventName) {
                if (
                    'properties' in gdprEntryOfCurrentlyComputingTelemetryEventName[1] &&
                    name in gdprEntryOfCurrentlyComputingTelemetryEventName[1]['properties']
                ) {
                    // Some times we share the properties of two events,
                    // When updating the values, we don't want to be overwriting the values of the other event.
                    gdprEntry = JSON.parse(
                        JSON.stringify(gdprEntryOfCurrentlyComputingTelemetryEventName[1]['properties'][name])
                    ) as IPropertyDataNonMeasurement;
                    (gdprEntryOfCurrentlyComputingTelemetryEventName[1]['properties'] as any)[name] = gdprEntry as any;
                }
                if (
                    'measures' in gdprEntryOfCurrentlyComputingTelemetryEventName[1] &&
                    name in gdprEntryOfCurrentlyComputingTelemetryEventName[1]['measures']
                ) {
                    // Some times we share the properties of two events,
                    // When updating the values, we don't want to be overwriting the values of the other event.
                    gdprEntry = JSON.parse(
                        JSON.stringify((gdprEntryOfCurrentlyComputingTelemetryEventName[1]['measures'] as any)[name])
                    ) as IPropertyDataNonMeasurement;
                    // All measures must be marked as isMeasurement=true
                    (gdprEntry as any).isMeasurement = true;
                    (gdprEntryOfCurrentlyComputingTelemetryEventName[1]['measures'] as any)[name] = gdprEntry as any;
                }
                if (gdprEntry) {
                    const comment = (descriptions || []).join(' ').split(/\r?\n/).join();
                    gdprEntry.comment = (gdprEntry.comment || '').trim();
                    if (gdprEntry.comment) {
                        if (
                            !comment
                                .split(/\r?\n/)
                                .map((line) => line.trim())
                                .join()
                                .includes(
                                    gdprEntry.comment
                                        .split(/\r?\n/)
                                        .map((line) => line.trim())
                                        .join()
                                )
                        ) {
                            descriptions.push(gdprEntry.comment);
                        }
                    }
                    if (
                        !gdprEntry.comment
                            .split(/\r?\n/)
                            .map((line) => line.trim())
                            .join()
                            .includes(
                                comment
                                    .split(/\r?\n/)
                                    .map((line) => line.trim())
                                    .join()
                            )
                    ) {
                        gdprEntry.comment = `${gdprEntry.comment}${
                            gdprEntry.comment.trim().length === 0 || gdprEntry.comment.trim().endsWith('.') ? ' ' : '. '
                        }${comment}`.trim();
                    }
                } else {
                    const gdprInfo = gdprEntryOfCurrentlyComputingTelemetryEventName[1];
                    const eventName = gdprEntryOfCurrentlyComputingTelemetryEventName[0];
                    const ownerIssues: Record<string, EventProblem> = (errorsByOwners[gdprInfo.owner] =
                        errorsByOwners[gdprInfo.owner] || {});
                    const eventIssues: EventProblem = (ownerIssues[eventName] = ownerIssues[eventName] || {
                        eventConstantName: '',
                        problems: []
                    });
                    eventIssues.problems.push(`Gdpr entry for ${name} not found.`);
                }
            }
            properties.push({ name, descriptions, possibleValues, type: typeValue, isNullable, gdpr: gdprEntry! });
        } else {
            throw new Error(`Unexpected node kind: ${m.kind}`);
        }
    });
    return properties;
}
function comptePropertyGroupsFromReferenceNode(t: ts.TypeReferenceNode, typeChecker: ts.TypeChecker) {
    if (t.typeName.getText() === 'Partial' && t.typeArguments?.length) {
        return computePropertyForType(t.typeArguments[0], typeChecker);
    }
    const type = typeChecker.getTypeAtLocation(t);
    if (type.aliasSymbol?.escapedName === 'Partial' && type.aliasTypeArguments?.length === 1) {
        if (
            type.aliasTypeArguments[0].symbol &&
            type.aliasTypeArguments[0].symbol.declarations &&
            type.aliasTypeArguments[0].symbol.declarations?.length === 1 &&
            type.aliasTypeArguments[0].symbol.declarations[0].kind === ts.SyntaxKind.TypeLiteral
        ) {
            const props = computePropertiesForLiteralType(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                type.aliasTypeArguments[0].symbol.declarations[0] as unknown as any,
                typeChecker
            );
            props.forEach((prop) => (prop.isNullable = true));
            return props;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } else if (Array.isArray((type.aliasTypeArguments[0] as any).types)) {
            const allProps: TelemetryProperty[] = [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (type.aliasTypeArguments[0] as any).types.map((item: any) => {
                if (
                    Array.isArray(item.symbol?.declarations) &&
                    item.symbol.declarations.length &&
                    item.symbol.declarations[0].kind === ts.SyntaxKind.TypeLiteral
                ) {
                    const props = computePropertiesForLiteralType(item.symbol.declarations[0], typeChecker);
                    props.forEach((prop) => (prop.isNullable = true));
                    allProps.push(...props);
                }
            });
            return allProps;
        }
    }

    const symbol = type.symbol || typeChecker.getSymbolAtLocation(t.typeName);

    if (symbol && symbol.declarations?.length === 1) {
        return computePropertyForType(symbol.declarations[0], typeChecker);
    }
    return [];
}
function comptePropertyGroupsForIntersectionTypes(type: ts.IntersectionTypeNode, typeChecker: ts.TypeChecker) {
    const properties: TelemetryProperty[] = [];
    type.types.forEach((t) => properties.push(...computePropertyForType(t, typeChecker)));
    return properties;
}
function comptePropertyGroupsForPrenthesizedTypes(type: ts.ParenthesizedTypeNode, typeChecker: ts.TypeChecker) {
    return computePropertyForType(type.type, typeChecker);
}
function computePropertyForType(type: ts.TypeNode | ts.Node, typeChecker: ts.TypeChecker): TelemetryProperty[] {
    if (ts.isTypeLiteralNode(type)) {
        return computePropertiesForLiteralType(type, typeChecker);
    } else if (ts.isUnionTypeNode(type)) {
        const props: TelemetryProperty[] = [];
        type.types.forEach((t) => {
            props.push(...computePropertyForType(t, typeChecker));
        });
    } else if (ts.isTypeReferenceNode(type)) {
        return comptePropertyGroupsFromReferenceNode(type, typeChecker);
    } else if (ts.isParenthesizedTypeNode(type)) {
        return comptePropertyGroupsForPrenthesizedTypes(type, typeChecker);
    } else if (ts.isIntersectionTypeNode(type)) {
        return comptePropertyGroupsForIntersectionTypes(type, typeChecker);
    } else if (ts.isTypeAliasDeclaration(type)) {
        return computePropertyForType(type.type, typeChecker);
    }
    return [];
}
function getCommentForUnions(t: ts.TypeNode) {
    const commentLines = t.getFullText().replace(t.getText(), '').split(/\r?\n/);
    const comment = commentLines.map((line, index) => {
        if (index === 0) {
            line = line.trim().startsWith('/**') ? line.trim().replace('/**', '') : line;
        }
        if (commentLines.length === index + 1) {
            // Last time, remove trailing `*/`
            return line.trim().endsWith('*/') ? line.trim().replace('*/', '') : line;
        } else {
            return line.trim().startsWith('*') ? line.trim().replace('*', '') : line;
        }
    });

    // Remove leading empty lines.
    while (comment.length > 0 && comment[0].trim().length === 0) {
        comment.shift();
    }

    return comment.length === 0 ? undefined : comment;
}

function indent(count: number = 1) {
    return ''.padEnd(count * 4, ' ');
}
type EventProblem = { eventConstantName: string; problems: string[] };
function writeTelemetryEntry(entry: TelemetryEntry) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gdprInfo = (GDPRData as any)[entry.name] as IEventData | undefined;
    const gdprProperties = new Map<string, IPropertyDataNonMeasurement>();
    const gdprMeasures = new Map<string, IPropertyDataMeasurement>();
    const eventErrorMessages: string[] = [];
    if (gdprInfo) {
        writeOutput(`* ${entry.name}  (${entry.constantName})  `);
        writeOutput(`${indent()}  Owner: [@${gdprInfo.owner}](https://github.com/${gdprInfo.owner})  `);
        if (!gdprInfo.feature) {
            eventErrorMessages.push(`Feature not defined`);
            writeOutput(`${indent()}   <span style="color:red">Feature not defined.</span>  `);
        }
        if (!gdprInfo.source) {
            eventErrorMessages.push(`Source not defined`);
            writeOutput(
                `${indent()}   <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  `
            );
        }

        Object.keys((gdprInfo as any).properties || {}).forEach((key) => {
            gdprProperties.set(key, (gdprInfo as any).properties[key]);
        });
        Object.keys((gdprInfo as any).measures || {}).forEach((key) => {
            gdprMeasures.set(key, (gdprInfo as any).measures[key]);
        });
        const discoveredProperties = new Set<string>();
        const discoveredMeasures = new Set<string>();
        const commonProperties = new Set(Object.keys(CommonProperties));

        entry.propertyGroups.forEach((g) =>
            g.properties
                .filter((p) => {
                    if (p.type === 'number') {
                        return false;
                    }
                    if (p.gdpr?.isMeasurement === true) {
                        return false;
                    }
                    return true;
                })
                .forEach((p) => discoveredProperties.add(p.name))
        );
        entry.propertyGroups.forEach((g) =>
            g.properties
                .filter((p) => {
                    if (p.type === 'number') {
                        return true;
                    }
                    if (p.gdpr?.isMeasurement === true) {
                        return true;
                    }
                    return false;
                })
                .forEach((p) => discoveredMeasures.add(p.name))
        );

        const undocumentedProperties = Array.from(discoveredProperties)
            .filter((p) => !commonProperties.has(p))
            .filter((p) => !gdprProperties.has(p));
        if (undocumentedProperties.length) {
            eventErrorMessages.push(
                `Properties not documented in GDPR ${undocumentedProperties.join(
                    ', '
                )}. Add jsDoc comments for the properties in telemetry.ts file.`
            );
            writeOutput(
                `${indent()}   <span style="color:red">Properties not documented in GDPR ${undocumentedProperties.join(
                    ', '
                )}. Add jsDoc comments for the properties in telemetry.ts file.</span>  `
            );
        }
        const undocumentedMeasures = Array.from(discoveredMeasures)
            .filter((p) => !commonProperties.has(p))
            .filter((p) => !gdprMeasures.has(p));
        if (undocumentedMeasures.length) {
            eventErrorMessages.push(
                `Measures not documented in GDPR ${undocumentedMeasures.join(
                    ', '
                )}. Add jsDoc comments for the properties in telemetry.ts file.`
            );
            writeOutput(
                `${indent()}   <span style="color:red">Measures not documented in GDPR ${undocumentedMeasures.join(
                    ', '
                )}. Add jsDoc comments for the measures in telemetry.ts file.</span>  `
            );
        }
    } else {
        eventErrorMessages.push(`Missing GDPR Info`);
        writeOutput(`* <span style="color:red">${entry.name}  (${entry.constantName})</span>  `);
        writeOutput(`${indent()}  `);
        writeOutput(`${indent()}<h3><span style="color:red"> Warning: Missing GDPR Info</span></h3>  `);
        writeOutput(`${indent()}  `);
    }
    const eventDescription = [entry.description].filter((item) => item.length).join('\n');
    if (eventDescription.length) {
        writeOutput(`${indent()}\`\`\``);
        eventDescription
            .trim()
            .split(/\r?\n/)
            .forEach((line) => {
                writeOutput(`${indent()}${line}  `);
            });
        writeOutput(`${indent()}\`\`\``);
        writeOutput(``);
    } else {
        eventErrorMessages.push(`Add jsDoc comments to describe this event.`);
        writeOutput(`${indent()}   <span style="color:red">Add jsDoc comments to describe this event.</span>  `);
    }
    if (!entry.propertyGroups || entry.propertyGroups.length === 0) {
    } else {
        const hasGroups = entry.propertyGroups.length > 1;
        entry.propertyGroups.forEach((group, index) => {
            if (hasGroups) {
                if (Array.isArray(group.description) && group.description.length) {
                    let wasPreviousLineEmpty = false;
                    group.description.forEach((line, i) => {
                        if (i === 0) {
                            writeOutput(`${indent()}- \`${line.trim()}\`:  `);
                        } else {
                            writeOutput(`${indent(wasPreviousLineEmpty ? 2 : 1)}${line}  `);
                        }
                        wasPreviousLineEmpty = line.trim().length === 0;
                    });
                } else {
                    const groupName = hasGroups ? ` Group ${index + 1}` : '';
                    writeOutput(`${indent()}- ${groupName}:  `);
                }
            }
            const properties = group.properties.filter((p) => p.type !== 'number');
            if (properties.length) {
                writeOutput(`${indent(hasGroups ? 2 : 1)}- Properties:  `);
                writePropertiesOrMeasures(properties, hasGroups ? 3 : 2);
            }
            const measures = group.properties.filter((p) => p.type === 'number');
            if (measures.length) {
                writeOutput(`${indent(hasGroups ? 2 : 1)}- Measures:  `);
                writePropertiesOrMeasures(measures, hasGroups ? 3 : 2);
            }
            function writePropertiesOrMeasures(items: TelemetryProperty[], startIndent: number) {
                items
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .forEach((p) => {
                        const description = Array.isArray(p.descriptions)
                            ? p.descriptions
                            : p.descriptions
                            ? p.descriptions.length
                                ? [p.descriptions]
                                : []
                            : [];
                        const isEmpty = description.join('').trim().length === 0;
                        if (isEmpty) {
                            eventErrorMessages.push(`Add jsDoc comments to describe this property = ${p.name}.`);
                        }
                        if (description.length || typeof p.type === 'string') {
                            const type = p.type ? `\`${p.type}\`` : '`<see below>`';
                            const nullable = p.isNullable ? '?' : '';
                            writeOutput(`${indent(startIndent)}- \`${p.name.trim()}\`${nullable}: ${type.trim()}  `);
                            let wasPreviousLineEmpty = false;
                            description.forEach((item) => {
                                // Empty lines inside lists messes up formatting and causes blank lines to appear
                                // in other places (i.e. increases the spacing between the list items).
                                if (item.trim().length) {
                                    writeOutput(
                                        `${indent(
                                            wasPreviousLineEmpty ? startIndent + 1 : startIndent
                                        )}${item.trim()}  `
                                    );
                                }
                                wasPreviousLineEmpty = item.trim().length === 0;
                            });
                            if (p.possibleValues?.length) {
                                writeOutput(`${indent(startIndent)}Possible values include:  `);
                                (p.possibleValues || []).forEach((description) => {
                                    writeOutput(`${indent(startIndent + 1)}- \`${description.value}\`  `);
                                    if (description.comment) {
                                        let wasPreviousLineEmpty = false;
                                        const comment = Array.isArray(description.comment)
                                            ? description.comment
                                            : description.comment.split(/\r?\n/);
                                        comment.forEach((line) => {
                                            // Empty lines inside lists messes up formatting and causes blank lines to appear
                                            // in other places (i.e. increases the spacing between the list items).
                                            if (line.trim().length) {
                                                writeOutput(
                                                    `${indent(
                                                        wasPreviousLineEmpty ? startIndent + 1 : startIndent
                                                    )}${line}  `
                                                );
                                            }
                                            wasPreviousLineEmpty = line.trim().length === 0;
                                        });
                                    }
                                });
                            }
                        } else {
                            writeOutput(`${indent(startIndent)}- ${p.name.trim()}  `);
                        }
                    });
            }
        });
    }
    writeOutput(`\n`);

    if (entry.gdpr.owner === 'unknown') {
        eventErrorMessages.push('No owner specified for this event');
    }
    if (eventErrorMessages.length) {
        const ownerIssues: Record<string, EventProblem> = (errorsByOwners[entry.gdpr.owner] =
            errorsByOwners[entry.gdpr.owner] || []);
        const eventProblem = (ownerIssues[entry.name] = ownerIssues[entry.name] || {
            eventConstantName: entry.constantName,
            problems: []
        });
        eventProblem.eventConstantName = entry.constantName;
        eventProblem.problems.push(...eventErrorMessages);
    }
}

const commonPropertyComments = new Map<string, string>();

/** True if this is visible outside this file, false otherwise */
function isNodeExported(node: ts.Node): boolean {
    return (
        (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0 ||
        (!!node.parent && node.parent.kind === ts.SyntaxKind.SourceFile)
    );
}

function getTsCompilerOptionsJson(): any {
    const tsconfigPath = path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'tsconfig.json');
    const jsonContent = ts.parseConfigFileTextToJson(tsconfigPath, fs.readFileSync(tsconfigPath, 'utf8'));
    return ts.convertCompilerOptionsFromJson(jsonContent.config.compilerOptions, '');
}

/** Generate documentation for all classes in a set of .ts files */
function generateDocumentationForCommonTypes(fileNames: string[]): void {
    const configFile = getTsCompilerOptionsJson();
    const program = ts.createProgram(fileNames, configFile.options);
    const typeChecker = program!.getTypeChecker();

    // Visit every sourceFile in the program
    if (program) {
        for (const sourceFile of program.getSourceFiles()) {
            if (!sourceFile.isDeclarationFile) {
                // Walk the tree to search for classes
                ts.forEachChild(sourceFile, visit.bind(undefined, sourceFile));
            }
        }
    }
    /** visit nodes finding exported classes */
    function visit(sourceFile: ts.SourceFile, node: ts.Node) {
        // Only consider exported nodes
        if (!isNodeExported(node)) {
            return;
        }
        if (ts.isModuleDeclaration(node)) {
            // This is a namespace, visit its children
            ts.forEachChild(node, visit.bind(undefined, sourceFile));
            return;
        }

        if (ts.isTypeAliasDeclaration(node) && CommonPropertyAndMeasureTypeNames.includes(node.name.text)) {
            computePropertyForType(node, typeChecker).forEach((prop) => {
                const comment =
                    typeof prop.descriptions === 'string' ? prop.descriptions : (prop.descriptions || []).join(' ');
                commonPropertyComments.set(prop.name, comment.split(/\n?\r/).join(' '));
            });
            return;
        }
    }
}

function generateDocumentation(fileNames: string[]): void {
    const configFile = getTsCompilerOptionsJson();
    const host = new TypeScriptLanguageServiceHost(fileNames, configFile.options);
    const languageService = ts.createLanguageService(host, undefined, ts.LanguageServiceMode.Semantic);
    const program = languageService.getProgram()!;
    const typeChecker = program!.getTypeChecker();
    const entries = new Map<string, TelemetryEntry>();

    // First generate documentation for common properties and measures.
    generateDocumentationForCommonTypes(fileNames);

    // Visit every sourceFile in the program
    if (program) {
        for (const sourceFile of program.getSourceFiles()) {
            if (!sourceFile.isDeclarationFile) {
                // Walk the tree to search for classes
                ts.forEachChild(sourceFile, visit.bind(undefined, sourceFile));
            }
        }
    }
    /** visit nodes finding exported classes */
    function visit(sourceFile: ts.SourceFile, node: ts.Node) {
        // Only consider exported nodes
        if (!isNodeExported(node)) {
            return;
        }
        if (ts.isModuleDeclaration(node)) {
            // This is a namespace, visit its children
            ts.forEachChild(node, visit.bind(undefined, sourceFile));
            return;
        }

        if (!ts.isClassDeclaration(node) || node.name?.text !== 'IEventNamePropertyMapping') {
            return;
        }

        try {
            node.members.forEach((m) => {
                if (ts.isPropertyDeclaration(m)) {
                    const typeNode = m.type;
                    if (!typeNode || typeNode.kind !== ts.SyntaxKind.TypeReference) {
                        console.error(`Unrecognized type ${m.name.getText()}`);
                    } else if (
                        typeNode &&
                        ts.isTypeReferenceNode(typeNode) &&
                        typeNode.typeArguments?.length === 1 &&
                        typeNode.typeName.getText() === 'TelemetryEventInfo'
                    ) {
                        let name = m.name.getText().trim();
                        let constantName = m.name.getText().trim().replace('[', '').replace(']', '');

                        if (m.name.kind === ts.SyntaxKind.ComputedPropertyName) {
                            const defs = languageService.getDefinitionAtPosition(
                                m.getSourceFile().fileName,
                                m.name.end - 1
                            );
                            if (defs) {
                                const refSourceFile = program!.getSourceFile(defs[0].fileName);
                                if (refSourceFile) {
                                    const refNode = findNode(
                                        refSourceFile,
                                        defs[0].textSpan.start,
                                        defs[0].textSpan.length
                                    );
                                    refNode?.parent?.getChildren()?.forEach((c) => {
                                        if (ts.isStringLiteral(c)) {
                                            name = c.text.trim();
                                        }
                                    });
                                }
                            }
                        } else if (ts.isStringLiteral(m.name)) {
                            name = m.name.text;
                            constantName = name;
                        }
                        gdprEntryOfCurrentlyComputingTelemetryEventName = [
                            name,
                            GDPRData[name as keyof IEventNamePropertyMapping] as TelemetryEventInfo<unknown>
                        ];
                        if (entries.has(name)) {
                            return;
                        }
                        let jsDocNode: ts.JSDoc | undefined;
                        let stopSearching = false;
                        m.getChildren().forEach((c) => {
                            if (stopSearching || c.kind === ts.SyntaxKind.ComputedPropertyName) {
                                stopSearching = true;
                                return;
                            }
                            if (stopSearching || c.kind === ts.SyntaxKind.ColonToken) {
                                stopSearching = true;
                                return;
                            }
                            if (ts.isJSDoc(c)) {
                                jsDocNode = c;
                                stopSearching = true;
                            }
                        });
                        const description =
                            typeof jsDocNode?.comment === 'string'
                                ? jsDocNode.comment
                                : (jsDocNode?.comment || []).map((item) => item.getText()).join('\n');
                        const currentGdprComment = (
                            gdprEntryOfCurrentlyComputingTelemetryEventName[1].comment || ''
                        ).trim();
                        gdprEntryOfCurrentlyComputingTelemetryEventName[1].comment = `${currentGdprComment}${
                            currentGdprComment.length === 0 || currentGdprComment.endsWith('.') ? ' ' : '. '
                        }${description}`.trim();
                        const type = typeNode.typeArguments[0];
                        const groups: TelemetryPropertyGroup[] = [];
                        if (ts.isTypeLiteralNode(type)) {
                            const properties = computePropertiesForLiteralType(type, typeChecker);
                            groups.push({ properties });
                        } else if (ts.isUnionTypeNode(type)) {
                            type.types.forEach((t) => {
                                const properties = computePropertyForType(t, typeChecker);
                                const comment = getCommentForUnions(t);
                                groups.push({ description: comment || [], properties });
                            });
                        } else if (ts.isTypeReferenceNode(type)) {
                            const properties = comptePropertyGroupsFromReferenceNode(type, typeChecker);
                            const comment = getCommentForUnions(type);
                            groups.push({ description: comment, properties });
                        } else if (ts.isIntersectionTypeNode(type)) {
                            const properties = comptePropertyGroupsForIntersectionTypes(type, typeChecker);
                            const comment = getCommentForUnions(type);
                            groups.push({ description: comment, properties });
                        } else if (
                            type.kind === ts.SyntaxKind.UndefinedKeyword ||
                            type.kind === ts.SyntaxKind.NeverKeyword
                        ) {
                            // Ignore
                        } else {
                            console.error(`Unknown type ${type.kind} in generating the Telemetry Documentation`);
                        }

                        const propertyGroups = groups.filter((group) => group.properties.length);
                        entries.set(name, {
                            name,
                            description,
                            constantName,
                            propertyGroups,
                            gdpr: gdprEntryOfCurrentlyComputingTelemetryEventName[1] as IEventData
                        });
                    }
                }
            });
        } catch (ex) {
            console.error(`Failure in generating telemetry documentation for ${node.getText()}`, ex);
        }
    }

    const values = Array.from(entries.values()).sort((a, b) =>
        a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
    );
    generateTelemetryMd(values);
    generateTelemetryCSV(values);
    generateTelemetryGdpr(values);

    if (Object.keys(errorsByOwners).length) {
        Object.keys(errorsByOwners).forEach((owner) => {
            console.error(colors.red(`Problems for ${owner}:`));
            const eventProblems: Record<string, EventProblem> = errorsByOwners[owner];
            Object.keys(eventProblems).forEach((eventName) => {
                const problems: EventProblem = eventProblems[eventName];
                console.error(colors.red(`    ${eventName} (${problems.eventConstantName}):`));
                problems.problems.forEach((error, index) => {
                    console.error(colors.red(`        ${index + 1}. ${error}`));
                });
            });
        });
        throw new Error('Has errors, check the logs');
    }
}

function generateTelemetryMd(output: TelemetryEntry[]) {
    fs.writeFileSync(`./TELEMETRY.md`, '');
    writeOutput('# Telemetry created by Jupyter Extension\n');
    writeOutput('Expand each section to see more information about that event.\n');
    output.forEach(writeTelemetryEntry);
}
function generateTelemetryCSV(output: TelemetryEntry[]) {
    const entries: {}[] = [];
    output.forEach((o) => {
        if (o.propertyGroups.length === 0) {
            // an event without any properties.
            entries.push({
                eventName: o.name,
                eventDescription: o.description,
                eventConstant: o.constantName,
                owner: o.gdpr.owner,
                feature: Array.isArray(o.gdpr.feature) ? o.gdpr.feature.join(', ') : o.gdpr.feature || '',
                tags: Array.isArray(o.gdpr.tags) ? o.gdpr.tags.join(', ') : o.gdpr.tags || '',
                groupDescription: '',
                propertyName: '',
                propertyDescription: '',
                propertyType: '',
                propertyPossibleValues: '',
                propertyIsNullable: ''
            });
        }
        o.propertyGroups.forEach((og) => {
            const groupDescription =
                typeof og.description === 'string' ? og.description : (og.description || []).join('\n');
            og.properties
                .sort((a, b) => a.name.localeCompare(b.name))
                .forEach((p) => {
                    const description = Array.isArray(p.descriptions)
                        ? p.descriptions.join('\n')
                        : p.descriptions || '';
                    const possibleValues =
                        Array.isArray(p.possibleValues) && p.possibleValues.length
                            ? p.possibleValues
                                  .map((item) => `${item.value} ${item.comment ? `(${item.comment})` : ''}`)
                                  .join('\n')
                            : '';

                    entries.push({
                        eventName: o.name,
                        eventDescription: o.description,
                        eventConstant: o.constantName,
                        owner: o.gdpr.owner,
                        feature: Array.isArray(o.gdpr.feature) ? o.gdpr.feature.join(', ') : o.gdpr.feature || '',
                        tags: Array.isArray(o.gdpr.tags) ? o.gdpr.tags.join(', ') : o.gdpr.tags || '',
                        groupDescription,
                        propertyName: p.name,
                        propertyDescription: description,
                        propertyType: p.type,
                        propertyPossibleValues: possibleValues,
                        propertyIsNullable: p.isNullable
                    });
                });
        });
    });

    const fields = Object.keys(entries[0]);
    const parser = new Parser({ fields });
    const csv = parser.parse(entries);
    fs.writeFileSync('./TELEMETRY.csv', csv);
}

const gdprHeader = `// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// This is an autogenerated file, do not modify this manually.

`;

function generateTelemetryGdpr(output: TelemetryEntry[]) {
    const file = './src/gdpr.ts';
    fs.writeFileSync(file, '');
    fs.appendFileSync(file, gdprHeader);
    const gdpr = '__GDPR__FRAGMENT__';
    fs.appendFileSync(file, `/* ${gdpr}\n`);
    fs.appendFileSync(file, `   "F1" : {\n`);
    const commonFields = ['     "${include}": ['];
    const fieldListForFile: string[] = [];
    Object.keys(CommonProperties).forEach((key) => {
        const entry = (CommonProperties as any)[key] as IPropertyDataMeasurement | IPropertyDataNonMeasurement;
        const isMeasurement = entry.isMeasurement === true;
        const jsDocComment = commonPropertyComments.get(key) || '';
        let comment = (entry.comment || '').split(/\r?\n/).join(' ').trim();
        comment = `${comment}${comment.length === 0 || comment.endsWith('.') ? '' : '. '}${jsDocComment}`.trim();
        if (!comment) {
            console.error(
                `No comments for common property ${key}, Update CommonPropertyAndMeasureTypeNames in telemetry.ts`
            );
        }

        // Do not include `__GDPR__` in the string with JSON comments, else telemetry tool treats this as a valid GDPR annotation.
        const json = {
            classification: 'SystemMetaData',
            purpose: 'FeatureInsight',
            isMeasurement: isMeasurement,
            comment: comment
        };
        fieldListForFile.push(`      "${key}": ${JSON.stringify(json)}`);
    });
    commonFields.push('       "${F1}"\n');
    commonFields.push('     ]');
    fs.appendFileSync(file, `${fieldListForFile.join(',\n')}\n`);
    fs.appendFileSync(file, `   }\n`);
    fs.appendFileSync(file, ` */\n`);
    fs.appendFileSync(file, '\n');

    output.forEach((item) => {
        // Do not include `__GDPR__` in the string with JSON comments, else telemetry tool treats this as a valid GDPR annotation.
        const gdpr = '__GDPR__';
        const header = [`//${item.constantName}`, `/* ${gdpr}`, `   "${item.name}" : {`];
        const footer = ['   }', ' */', '', ''];
        const properties: Record<string, IPropertyDataNonMeasurement> =
            'properties' in item.gdpr ? item.gdpr['properties'] : {};
        const measures: Record<string, IPropertyDataMeasurement> = 'measures' in item.gdpr ? item.gdpr['measures'] : {};
        const entries: string[] = [];
        Object.keys(properties).forEach((key) => {
            if (key in CommonProperties) {
                return;
            }
            const prop = properties[key];
            const json: Record<string, string> = {
                classification: prop.classification,
                purpose: prop.purpose,
                comment: prop.comment || '',
                owner: item.gdpr.owner
            };
            if (prop.expiration) {
                json.expiration = prop.expiration;
            }
            entries.push(`     "${key}": ${JSON.stringify(json)},`);
        });
        Object.keys(measures).forEach((key) => {
            if (key in CommonProperties) {
                return;
            }
            const prop = measures[key];
            const json: Record<string, string | boolean> = {
                classification: prop.classification,
                purpose: prop.purpose,
                comment: prop.comment || '',
                owner: item.gdpr.owner,
                isMeasurement: true
            };
            if (prop.expiration) {
                json.expiration = prop.expiration;
            }
            entries.push(`     "${key}": ${JSON.stringify(json)},`);
        });
        fs.appendFileSync(
            file,
            `${header.join('\n')}\n${entries.join('\n')}${entries.length ? '\n' : ''}${commonFields.join(
                '\n'
            )}\n${footer.join('\n')}`.trim()
        );
        fs.appendFileSync(file, `\n`);
    });
}

async function generateTelemetryOutput() {
    const files = await new Promise<string[]>((resolve, reject) => {
        glob(path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src/**/*.ts'), (ex, res) => {
            if (ex) {
                reject(ex);
            } else {
                resolve(res);
            }
        });
    });
    // Print out the source tree
    return generateDocumentation(files);
}

const promise = generateTelemetryOutput();
/**
 * Returns an error message if there are any errors, else returns undefined.
 */
export default async function (): Promise<void> {
    return promise;
}
