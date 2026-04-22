import { describe, it, expect } from 'vitest';
import { parseUserPassBlock } from '../parseStockCredential';

describe('parseUserPassBlock', () => {
    it('parses User / Pass block with blank lines', () => {
        const s = `User
V130 

Pass
474669`;
        expect(parseUserPassBlock(s)).toEqual({
            username: 'V130',
            password: '474669',
        });
    });
});
