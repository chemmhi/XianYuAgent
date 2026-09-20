import { describe, expect, it } from 'vitest';
import { filtersForStatus, getOrderDisplayStatus, orderDisplayStatusLabel, statusFilterFromFilters } from './order-status';

describe('order status presentation', () => {
  it('maps the single UI filter to existing canonical status fields', () => {
    expect(filtersForStatus('pending_payment')).toMatchObject({ paymentStatus: 'unpaid', orderStatus: 'all', deliveryStatus: 'all', afterSalesStatus: 'all' });
    expect(filtersForStatus('pending_receipt')).toMatchObject({ paymentStatus: 'all', orderStatus: 'open', deliveryStatus: 'delivered', afterSalesStatus: 'all' });
    expect(filtersForStatus('pending_review')).toMatchObject({ orderStatus: 'completed', deliveryStatus: 'delivered' });
    expect(filtersForStatus('refunding')).toMatchObject({ afterSalesStatus: 'refunding' });
    expect(statusFilterFromFilters({ paymentStatus: 'unpaid', orderStatus: 'all', deliveryStatus: 'all', afterSalesStatus: 'all' })).toBe('pending_payment');
  });

  it('derives the current display status without collapsing canonical fields', () => {
    expect(getOrderDisplayStatus({ paymentStatus: 'unpaid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none' })).toBe('pending_payment');
    expect(getOrderDisplayStatus({ paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'delivered', afterSalesStatus: 'none' })).toBe('pending_receipt');
    expect(getOrderDisplayStatus({ paymentStatus: 'paid', orderStatus: 'completed', deliveryStatus: 'delivered', afterSalesStatus: 'none' })).toBe('pending_review');
    expect(orderDisplayStatusLabel('refunding')).toBe('退款中');
  });
});
