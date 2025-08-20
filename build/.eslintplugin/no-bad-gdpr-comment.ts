/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as eslint from 'eslint';

export = new class NoBadGDPRComment implements eslint.Rule.RuleModule {

	create(context: eslint.Rule.RuleContext): eslint.Rule.RuleListener {

		return {
			['Program'](node) {
				for (const comment of (<eslint.AST.Program>node).comments) {
					if (comment.type !== 'Block' || !comment.loc) {
						continue;
					}
					if (!comment.value.includes('__GDPR__')) {
						continue;
					}

					const dataStart = comment.value.indexOf('\n');
					const data = comment.value.substring(dataStart)

					let gdprData: { [key: string]: object } | undefined

					try {
						const jsonRaw = `{ ${data} }`
						gdprData = JSON.parse(jsonRaw);
					} catch (e) {
						context.report({
							loc: { start: comment.loc.start, end: comment.loc.end },
							message: 'GDPR comment is not valid JSON'
						});
					}

					if (gdprData) {
						const len = Object.keys(gdprData).length;
						if (len !== 1) {
							context.report({
								loc: { start: comment.loc.start, end: comment.loc.end },
								message: `GDPR comment must contain exactly one key, not ${Object.keys(gdprData).join(', ')}`
							});
						}
					}
				}
			}
		};
	}
};
