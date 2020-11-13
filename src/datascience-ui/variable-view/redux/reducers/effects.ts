// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { CssMessages } from '../../../../client/datascience/messages';
import { IJupyterExtraSettings } from '../../../../client/datascience/types';
import { IMainState } from '../../../interactive-common/mainState';
import { postActionToExtension } from '../../../interactive-common/redux/helpers';
import { Helpers } from '../../../interactive-common/redux/reducers/helpers';
import { computeEditorOptions } from '../../../react-common/settingsReactSide';
import { VariableViewPanelReducerArg } from '../mapping';

export namespace Effects {
    export function updateSettings(arg: VariableViewPanelReducerArg<string>): IMainState {
        // String arg should be the IDataScienceExtraSettings
        const newSettingsJSON = JSON.parse(arg.payload.data);
        const newSettings = <IJupyterExtraSettings>newSettingsJSON;
        const newEditorOptions = computeEditorOptions(newSettings);
        const newFontFamily = newSettings.extraSettings
            ? newSettings.extraSettings.editor.fontFamily
            : arg.prevState.font.family;
        const newFontSize = newSettings.extraSettings
            ? newSettings.extraSettings.editor.fontSize
            : arg.prevState.font.size;

        // Ask for new theme data if necessary
        if (
            newSettings &&
            newSettings.extraSettings &&
            newSettings.extraSettings.theme !== arg.prevState.vscodeThemeName
        ) {
            const knownDark = Helpers.computeKnownDark(newSettings);
            // User changed the current theme. Rerender
            postActionToExtension(arg, CssMessages.GetCssRequest, { isDark: knownDark });
        }

        return {
            ...arg.prevState,
            settings: newSettings,
            editorOptions: newEditorOptions,
            font: {
                size: newFontSize,
                family: newFontFamily
            }
        };
    }
}
