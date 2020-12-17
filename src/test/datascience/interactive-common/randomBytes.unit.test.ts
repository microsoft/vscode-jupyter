import { assert } from 'chai';

import { PlatformService } from '../../../client/common/platform/platformService';
import { SystemPseudoRandomNumberGenerator } from '../../../client/datascience/interactive-ipynb/randomBytes';
import { ISystemPseudoRandomNumberGenerator } from '../../../client/datascience/types';

suite('DataScience - RandomBytes', () => {
    let prng: ISystemPseudoRandomNumberGenerator;
    setup(() => {
        const platformService = new PlatformService();
        prng = new SystemPseudoRandomNumberGenerator(platformService);
    });

    test('Generate random bytes', async () => {
        const numRequestedBytes = 1024;
        const generatedKey = await prng.generateRandomKey(numRequestedBytes);
        const generatedKeyLength = generatedKey.length;
        assert.ok(
            generatedKeyLength === numRequestedBytes * 2, // *2 because the bytes are returned as hex
            `Expected to generate ${numRequestedBytes} random bytes but instead generated ${generatedKeyLength} random bytes`
        );
        assert.ok(generatedKey !== '', `Generated key is null`);
    });
});
