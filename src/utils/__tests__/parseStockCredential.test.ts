import { describe, it, expect } from 'vitest';
import { parseBulkStockRows, parseUserPassBlock } from '../parseStockCredential';

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

describe('parseBulkStockRows', () => {
    it('parses CSV with explicit headers', () => {
        const csv = `username,password,config,format
vpn-user-1,pass-1,vmess://abcd,v2ray`;
        expect(parseBulkStockRows(csv)).toEqual([
            {
                username: 'vpn-user-1',
                password: 'pass-1',
                configText: 'vmess://abcd',
                configFormat: 'v2ray',
            },
        ]);
    });

    it('parses single-column v2ray links (embedded credentials)', () => {
        const text = `vmess://eyJhZGQiOiIxLjIuMy40In0=
vless://uuid@example.com:443?type=ws`;
        expect(parseBulkStockRows(text)).toEqual([
            {
                username: null,
                password: null,
                configText: 'vmess://eyJhZGQiOiIxLjIuMy40In0=',
                configFormat: 'v2ray',
            },
            {
                username: null,
                password: null,
                configText: 'vless://uuid@example.com:443?type=ws',
                configFormat: 'v2ray',
            },
        ]);
    });
});
