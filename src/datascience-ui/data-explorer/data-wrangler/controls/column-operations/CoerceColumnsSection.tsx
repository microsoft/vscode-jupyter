import { Dropdown, IDropdownOption, ResponsiveMode } from '@fluentui/react';
import * as React from 'react';
import {
    ICoerceColumnRequest
} from '../../../../../client/datascience/data-viewing/data-wrangler/types';
import { dropdownStyle, dropdownStyles } from '../styles';

interface IProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setArgs(args: any): void;
}

interface IState {
    newColumnType: string;
}

export class CoerceColumnsSection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
        this.state = {
            newColumnType: ''
        };
        this.props.setArgs({ newType: '' } as ICoerceColumnRequest);
    }

    private getCoercableTypes() {
        const coercableTypes = ['string', 'float', 'bool', 'int'];
        const coercableOptions = [];
        for (let i = 0; i < coercableTypes.length; i++) {
            const option = { key: i, text: coercableTypes[i] };
            coercableOptions.push(option);
        }
        return coercableOptions;
    }

    render() {
        return (
            <div className="slice-control-row" style={{ paddingBottom: '5px', paddingTop: '6px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                    <Dropdown
                        label={'New column type'}
                        responsiveMode={ResponsiveMode.xxxLarge}
                        style={dropdownStyle}
                        styles={dropdownStyles}
                        options={this.getCoercableTypes()}
                        className="dropdownTitleOverrides"
                        onChange={this.updateTypeTarget}
                    />
                </div>
            </div>
        );
    }

    private updateTypeTarget = (_data: React.FormEvent, option: IDropdownOption | undefined) => {
        if (option) {
            this.props.setArgs({ newType: option.text } as ICoerceColumnRequest);
        }
    };
}
