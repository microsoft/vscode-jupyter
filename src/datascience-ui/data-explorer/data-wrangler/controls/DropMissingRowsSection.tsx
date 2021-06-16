import { IDropdownOption } from '@fluentui/react';
import * as React from 'react';

interface IProps {
    headers: string[];
    options: IDropdownOption[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submitCommand(data: { command: string; args: any }): void;
}

interface IState {
    dropNaTarget: number | null;
}

export class DropMissingRowsSection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
        this.state = { dropNaTarget: 0 };
    }

    render() {
        return (
            // <details
            //     className="slicing-control"
            //     style={{
            //         borderBottom: '1px solid var(--vscode-editor-inactiveSelectionBackground)',
            //         paddingTop: '4px',
            //         paddingBottom: '4px'
            //     }}
            // >
            //     <summary className="slice-summary">
            //         <span className="slice-summary-detail">{'MISSING VALUES'}</span>
            //     </summary>
            //     <div className="slice-control-row slice-form-container" style={{ paddingBottom: '5px' }}>
            //         <div
            //             style={{
            //                 /* paddingLeft: '10px', */ display: 'flex',
            //                 flexDirection: 'column',
            //                 width: '150px',
            //                 paddingTop: '6px',
            //                 marginRight: '10px'
            //             }}
            //         >
            //             <Dropdown
            //                 responsiveMode={ResponsiveMode.xxxLarge}
            //                 label={'Drop:'}
            //                 style={{ marginRight: '10px', width: '150px' }}
            //                 styles={dropdownStyles}
            //                 options={this.generateDropNaOptions()}
            //                 className="dropdownTitleOverrides"
            //                 onChange={this.updateDropNaTarget}
            //             />
            //         </div>
            <button
                onClick={() =>
                    this.props.submitCommand({
                        command: 'dropna',
                        args: { target: 0 }
                    })
                }
                style={{
                    width: '50px',
                    backgroundColor: 'var(--vscode-button-background)',
                    color: 'var(--vscode-button-foreground)',
                    margin: '0px',
                    padding: '4px',
                    border: 'none',
                    cursor: 'pointer',
                    height: '26px'
                    // marginTop: '28px'
                }}
            >
                Drop
            </button>
            //     </div>
            // </details>
        );
    }

    // private generateDropNaOptions() {
    //     return [
    //         { key: 0, text: 'Rows' },
    //         { key: 1, text: 'Columns' }
    //     ];
    // }

    // private updateDropNaTarget = (_data: React.FormEvent, item: IDropdownOption | undefined) => {
    //     if (item) {
    //         this.setState({ dropNaTarget: item.key as number });
    //     }
    // };
}
