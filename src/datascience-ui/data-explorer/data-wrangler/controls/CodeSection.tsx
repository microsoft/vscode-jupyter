import * as React from 'react';
import { Code } from '../../../interactive-common/code';
import { PYTHON_LANGUAGE } from '../../../../client/common/constants';
import { SidePanelSection } from './SidePanelSection';
import { Identifiers } from '../../../../client/datascience/constants';
import { getLocString } from '../../../react-common/locReactSide';

interface IProps {
    collapsed: boolean;
    currentVariableName: string | undefined;
    code: string;
    monacoTheme: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submitCommand(data: { command: string; args: any }): void;
}

interface IState {
    currentVariableIndex: number | undefined;
}

export class CodeSection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
        this.state = { currentVariableIndex: 0 };
    }

    render() {
        const codeComponent = (
            <div
                style={{
                    marginLeft: '-10px',
                    marginTop: '10px',
                    marginRight: '20px',
                    width: '100%',
                    backgroundColor: 'var(--vscode-editor-background) !important'
                }}
            >
                <Code
                    code={this.props.code.trimEnd()}
                    language={PYTHON_LANGUAGE}
                    readOnly={true}
                    version={0}
                    testMode={false}
                    history={undefined}
                    showWatermark={false}
                    monacoTheme={this.props.monacoTheme}
                    codeTheme={Identifiers.GeneratedThemeName}
                    hasFocus={false}
                    cursorPos={0}
                    ipLocation={undefined}
                    // eslint-disable-next-line @typescript-eslint/no-empty-function
                    onCreated={() => {}}
                    // eslint-disable-next-line @typescript-eslint/no-empty-function
                    onChange={() => {}}
                    disableUndoStack={true}
                    focusPending={0}
                    editorOptions={{
                        renderFinalNewline: false,
                        lineNumbers: 'on',
                        lineDecorationsWidth: 8
                        // wordWrap: 'bounded', TODOV
                        // wordWrapColumn: 10
                    }}
                    outermostParentClass=""
                    // eslint-disable-next-line @typescript-eslint/no-empty-function
                    openLink={() => {}}
                    font={{ size: 12, family: 'var(--vscode-editor-font-family' }}
                    showLineNumbers={true}
                />
            </div>
        );

        return (
            <SidePanelSection title={getLocString("DataScience.dataWranglerPanelCode", "CODE")} panel={codeComponent} collapsed={this.props.collapsed} height={'100px'} />
        );
    }
}
