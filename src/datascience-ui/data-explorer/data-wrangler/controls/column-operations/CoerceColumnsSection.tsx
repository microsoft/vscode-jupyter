import { Dropdown, IDropdownOption, ResponsiveMode } from '@fluentui/react';
import * as React from 'react';
import { DataWranglerCommands, ICoerceColumnRequest } from '../../../../../client/datascience/data-viewing/data-wrangler/types';
import { submitButtonStyle, dropdownStyle, dropdownStyles } from '../styles';

interface IProps {
    selectedColumns: string[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submitCommand(data: { command: string; args: any }): void;
    setColumns(cols: number[]): void;
}

interface IState {
    newColumnType: string | undefined;
}

export class CoerceColumnsSection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
        this.state = {
            newColumnType: ''
        };
    }

    private getCoercableTypes() {
        const coercableTypes = ['string', 'float', 'bool', 'int'];
        const coercableOptions = [];
        for (let i = 0; i < coercableTypes.length; i++) {
            const option = {key: i, text: coercableTypes[i]};
            coercableOptions.push(option);
        }
        return coercableOptions;
    }

    render() {
        return (
            <div className="slice-control-row" style={{ paddingBottom: '5px', paddingTop: '6px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', width: '140px' }}>
                    <Dropdown
                        label={'New column type'}
                        responsiveMode={ResponsiveMode.xxxLarge}
                        style={dropdownStyle}
                        styles={dropdownStyles}
                        options={this.getCoercableTypes()}
                        className="dropdownTitleOverrides"
                        onChange={this.updateTypeTarget}
                    />
                    <button
                        onClick={() => {
                            if (this.state.newColumnType) {
                                this.props.submitCommand({
                                    command: DataWranglerCommands.CoerceColumn,
                                    args: {
                                        targetColumns: this.props.selectedColumns,
                                        newType: this.state.newColumnType
                                    } as ICoerceColumnRequest
                                });
                            }
                        }}
                        style={submitButtonStyle}
                    >
                        Submit
                    </button>
                </div>
            </div>
        );
    }

    private updateTypeTarget = (_data: React.FormEvent, option: IDropdownOption | undefined) => {
        console.log('Update coerce type', option);
        this.setState({ newColumnType: option?.text });
    };
}
