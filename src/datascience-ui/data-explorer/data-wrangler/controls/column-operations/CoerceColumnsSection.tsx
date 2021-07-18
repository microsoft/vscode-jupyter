import { Dropdown, IDropdownOption, ResponsiveMode } from '@fluentui/react';
import * as React from 'react';
import { ICoerceColumnRequest } from '../../../../../client/datascience/data-viewing/data-wrangler/types';
import { getLocString } from '../../../../react-common/locReactSide';
import { dropdownStyle, dropdownStyles } from '../styles';

interface IProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setArgs(args: any): void;
}

interface IState {
    newColumnType: string;
}

const COERCABLE_TYPES = ['string', 'float', 'bool', 'int'];

export class CoerceColumnsSection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
        this.state = {
            newColumnType: ''
        };
        this.props.setArgs({ newType: '' } as ICoerceColumnRequest);
    }

    private getCoercableTypes() {
        return COERCABLE_TYPES.map((type, index) => ({ key: index, text: type }));
    }

    render() {
        return (
            <>
                <Dropdown
                    label={getLocString('DataScience.dataWranglerNewType', 'New Type')}
                    responsiveMode={ResponsiveMode.xxxLarge}
                    style={dropdownStyle}
                    styles={dropdownStyles}
                    options={this.getCoercableTypes()}
                    className="dropdownTitleOverrides"
                    onChange={this.updateTypeTarget}
                />
            </>
        );
    }

    private updateTypeTarget = (_data: React.FormEvent, option: IDropdownOption | undefined) => {
        if (option) {
            this.props.setArgs({ newType: option.text } as ICoerceColumnRequest);
        }
    };
}
