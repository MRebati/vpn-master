import { describe, it, expect } from 'vitest';
import { filterProductTypesForInline, normalizeInlineSearch } from '../adminInlineQuery';
import type { VpnProductType } from '../../types';

const sample: VpnProductType[] = [
    {
        id: 1,
        slug: '1month',
        label_fa: 'یک‌ماهه',
        unit: 'days',
        metric_value: 30,
        price_toman: 150000,
        sort_order: 1,
        is_active: true,
        created_at: '',
    },
    {
        id: 2,
        slug: 'g50',
        label_fa: 'پنجاه گیگ',
        unit: 'gb',
        metric_value: 50,
        price_toman: 400000,
        sort_order: 2,
        is_active: true,
        created_at: '',
    },
];

describe('adminInlineQuery', () => {
    it('normalizeInlineSearch handles ي/ك', () => {
        expect(normalizeInlineSearch('يك')).toBe('یک');
    });

    it('filterProductTypesForInline returns all when query empty', () => {
        expect(filterProductTypesForInline(sample, '')).toHaveLength(2);
    });

    it('filterProductTypesForInline matches label_fa', () => {
        expect(filterProductTypesForInline(sample, 'پنجاه')).toHaveLength(1);
        expect(filterProductTypesForInline(sample, 'g50')).toHaveLength(1);
    });
});
