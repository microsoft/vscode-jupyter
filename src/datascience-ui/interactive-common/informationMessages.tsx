// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import * as React from 'react';

// eslint-disable-next-line
interface IInformationMessagesProps {
    messages: string[];
}

export class InformationMessages extends React.Component<IInformationMessagesProps> {
    constructor(prop: IInformationMessagesProps) {
        super(prop);
    }

    public render() {
        const output = this.props.messages.join('\n');
        const wrapperClassName = 'messages-wrapper';
        const outerClassName = 'messages-outer';

        return (
            <div className={wrapperClassName}>
                <div className={outerClassName}>
                    <div className="messages-result-container">
                        <pre>
                            <span>{output}</span>
                        </pre>
                    </div>
                </div>
            </div>
        );
    }
}
